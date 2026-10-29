#include "workflow_sqlite.h"
#include <sqlite3.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <cstring>
#include <cstdlib>
#include <string>
#include <memory>
#include <limits>
#include <mutex>

struct wf_store {
  sqlite3 *db = nullptr;
  wf_authorize_fn authorize = nullptr;
  wf_verify_receipt_fn verify = nullptr;
  void *context = nullptr;
  std::mutex mutex;
};
namespace {
using S = std::unique_ptr<sqlite3_stmt,decltype(&sqlite3_finalize)>;
constexpr int64_t limit = 2147483646;
int safe(const char *s, size_t size=96) {
  if (!s) return 0;
  size_t n=strnlen(s,size+1);
  if (!n || n>size) return 0;
  for (size_t i=0;i<n;i++) if (!((s[i]>='a'&&s[i]<='z') ||
    (s[i]>='A'&&s[i]<='Z') || (s[i]>='0'&&s[i]<='9') ||
    s[i]=='_' || s[i]=='-')) return 0;
  return 1;
}
int hex(const char *s, size_t n) {
  if (!s || strnlen(s,n+1)!=n) return 0;
  for (size_t i=0;i<n;i++) if (!((s[i]>='a'&&s[i]<='f') ||
    (s[i]>='0'&&s[i]<='9'))) return 0;
  return 1;
}
int receipt_valid(const char *s) {
  if(!s) return 0;
  size_t n=strnlen(s,161);
  if(!n || n>160) return 0;
  for(size_t i=0;i<n;i++) if(!((s[i]>='a'&&s[i]<='z') ||
    (s[i]>='A'&&s[i]<='Z') || (s[i]>='0'&&s[i]<='9') ||
    s[i]=='_' || s[i]=='-' || s[i]=='.' || s[i]==':'))return 0;
  return 1;
}
int run_id(const char *t,const char *r,const char *rev) {
  return safe(t) && safe(r) && hex(rev,40);
}
int auth(wf_store *s,const char *act,const char *t,const char *r,
 const char *rev,int64_t epoch,int64_t version,const char *step=nullptr,
 const char *key=nullptr,const char *digest=nullptr,
 const char *message_id=nullptr,const char *outcome=nullptr,const char *receipt=nullptr) {
  if(!s||!s->authorize) return WF_UNAUTHORIZED;
  return s->authorize(s->context,act,t,r,rev,epoch,version,step,key,digest,message_id,outcome,receipt)==1 ? WF_OK : WF_UNAUTHORIZED;
}
S prepare(wf_store *s, const char *sql) {
  sqlite3_stmt *raw=nullptr;
  if(sqlite3_prepare_v2(s->db,sql,-1,&raw,nullptr)!=SQLITE_OK) return S(nullptr,sqlite3_finalize);
  return S(raw,sqlite3_finalize);
}
void bind(sqlite3_stmt *p,int i,const char *v) { sqlite3_bind_text(p,i,v,-1,SQLITE_TRANSIENT); }
void bind(sqlite3_stmt *p,int i,int64_t v) { sqlite3_bind_int64(p,i,v); }
int step_done(sqlite3_stmt *p) {
  int rc=sqlite3_step(p);
  if(rc==SQLITE_CONSTRAINT || (rc & 0xff)==SQLITE_CONSTRAINT) return WF_DUPLICATE;
  return rc==SQLITE_DONE ? WF_OK : WF_STORAGE_ERROR;
}
struct Tx {
  wf_store *s; bool active=false;
  explicit Tx(wf_store *store,bool immediate=true):s(store) {
    active=sqlite3_exec(s->db,immediate?"BEGIN IMMEDIATE":"BEGIN",nullptr,nullptr,nullptr)==SQLITE_OK;
  }
  ~Tx(){if(active)sqlite3_exec(s->db,"ROLLBACK",nullptr,nullptr,nullptr);}
  bool commit() {if(!active)return false; if(sqlite3_exec(s->db,"COMMIT",nullptr,nullptr,nullptr)!=SQLITE_OK)return false;active=false;return true;}
};
int fenced(wf_store *s,const char *t,const char *r,const char *rev,
  int64_t epoch,int64_t ver) {
  auto p=prepare(s,"SELECT epoch,version,phase FROM workflow WHERE tenant=? AND run=? AND revision=?");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,rev);
  int rc=sqlite3_step(p.get());
  if(rc==SQLITE_DONE) return WF_FENCED;
  if(rc!=SQLITE_ROW)return WF_STORAGE_ERROR;
  return (sqlite3_column_int64(p.get(),0)==epoch && sqlite3_column_int64(p.get(),1)==ver &&
      strcmp((const char*)sqlite3_column_text(p.get(),2),"running")==0 && ver<limit)
    ? WF_OK : WF_FENCED;
}
int bump(wf_store *s,const char *t,const char *r) {
  auto p=prepare(s,"UPDATE workflow SET version=version+1 WHERE tenant=? AND run=?");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);return step_done(p.get());
}
int ensure_private(const char *dir,std::string &path) {
  if(!dir||strnlen(dir,4097)>4096)return WF_INVALID;
  struct stat st{};
  if(lstat(dir,&st)!=0 || !S_ISDIR(st.st_mode) || (st.st_mode & 077)!=0 || st.st_uid!=geteuid())return WF_INVALID;
  path=std::string(dir)+"/workflow-native.sqlite";
  // Existing file must not be a symlink or hardlink to another target.
  int fd=open(path.c_str(),O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
  if(fd<0){
