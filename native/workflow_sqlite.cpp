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
    if(errno!=EEXIST)return WF_STORAGE_ERROR;
    if(lstat(path.c_str(),&st)!=0 || !S_ISREG(st.st_mode) || st.st_nlink!=1 ||
       (st.st_mode & 077)!=0 || st.st_uid!=geteuid())return WF_INVALID;
  } else close(fd);
  return WF_OK;
}
}
extern "C" {
int wf_open(const char *directory,wf_authorize_fn authorize,wf_verify_receipt_fn verify,
 void *context,wf_store **out) {
  if(out)*out=nullptr;
  if(!out||!authorize||!verify)return WF_INVALID;
  std::string path;
  int ok=ensure_private(directory,path); if(ok!=WF_OK)return ok;
  std::unique_ptr<wf_store> s(new wf_store);
  s->authorize=authorize;s->verify=verify;s->context=context;
  if(sqlite3_open_v2(path.c_str(),&s->db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,nullptr)!=SQLITE_OK){
    if(s->db) sqlite3_close(s->db);
    return WF_STORAGE_ERROR;
  }
  sqlite3_busy_timeout(s->db,5000);
  // journal_mode=WAL is required for concurrent processes.
  auto jm=prepare(s.get(),"PRAGMA journal_mode");
  if(!jm || sqlite3_step(jm.get())!=SQLITE_ROW){sqlite3_close(s->db);return WF_STORAGE_ERROR;}
  std::string mode=(const char*)sqlite3_column_text(jm.get(),0);jm.reset();
  if(mode!="wal" && sqlite3_exec(s->db,"PRAGMA journal_mode=WAL",nullptr,nullptr,nullptr)!=SQLITE_OK){sqlite3_close(s->db);return WF_STORAGE_ERROR;}
  if(sqlite3_exec(s->db,"PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",nullptr,nullptr,nullptr)!=SQLITE_OK){sqlite3_close(s->db);return WF_STORAGE_ERROR;}
  const char *schema=R"SQL(
   CREATE TABLE IF NOT EXISTS workflow(tenant TEXT NOT NULL,run TEXT NOT NULL,
    revision TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT 'running',PRIMARY KEY(tenant,run));
   CREATE TABLE IF NOT EXISTS effects(tenant TEXT NOT NULL,run TEXT NOT NULL,step TEXT NOT NULL,
    effect_key TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,state TEXT NOT NULL,
    receipt TEXT UNIQUE,PRIMARY KEY(tenant,run,step),
    FOREIGN KEY(tenant,run) REFERENCES workflow(tenant,run));
   CREATE TABLE IF NOT EXISTS inbox(tenant TEXT NOT NULL,run TEXT NOT NULL,
    message_id TEXT NOT NULL,step TEXT NOT NULL,effect_key TEXT NOT NULL,
    digest TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'accepted',
    PRIMARY KEY(tenant,run,message_id),UNIQUE(tenant,run,step),
    FOREIGN KEY(tenant,run) REFERENCES workflow(tenant,run),
    FOREIGN KEY(effect_key) REFERENCES effects(effect_key));
  )SQL";
  if(sqlite3_exec(s->db,schema,nullptr,nullptr,nullptr)!=SQLITE_OK){sqlite3_close(s->db);return WF_STORAGE_ERROR;}
  *out=s.release();return WF_OK;
}
void wf_close(wf_store *s) {if(s){sqlite3_close(s->db);delete s;}}
int wf_create_run(wf_store *s,const char *t,const char *r,const char *rev) {
  if(!run_id(t,r,rev))return WF_INVALID;
  int a=auth(s,"create_run",t,r,rev,0,0);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  auto p=prepare(s,"INSERT INTO workflow(tenant,run,revision) VALUES(?,?,?)");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,rev);
  int rc=step_done(p.get());p.reset();if(rc)return rc;
  return tx.commit()?WF_OK:WF_STORAGE_ERROR;
}
int wf_activate(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t expected,int64_t *epoch,int64_t *version) {
  if(!run_id(t,r,rev)||expected<0||expected>=limit||!epoch||!version)return WF_INVALID;
  int a=auth(s,"activate",t,r,rev,expected,0);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  auto p=prepare(s,"UPDATE workflow SET epoch=epoch+1,version=version+1 WHERE tenant=? AND run=? AND revision=? AND epoch=? AND epoch<? AND phase='running'");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,rev);bind(p.get(),4,expected);bind(p.get(),5,limit);
  if(step_done(p.get()))return WF_STORAGE_ERROR;
  if(sqlite3_changes(s->db)!=1)return WF_FENCED;
  p.reset();
  auto q=prepare(s,"SELECT epoch,version FROM workflow WHERE tenant=? AND run=?");
  if(!q)return WF_STORAGE_ERROR;
  bind(q.get(),1,t);bind(q.get(),2,r);
  if(sqlite3_step(q.get())!=SQLITE_ROW)return WF_STORAGE_ERROR;
  int64_t e=sqlite3_column_int64(q.get(),0),v=sqlite3_column_int64(q.get(),1);
  q.reset();if(!tx.commit())return WF_STORAGE_ERROR;
  *epoch=e;*version=v;return WF_OK;
}
int wf_accept_step(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t epoch,int64_t version,const char *step,const char *msg,const char *key,
 const char *digest,int64_t *new_version) {
  if(!run_id(t,r,rev)||!safe(step)||!safe(msg)||!safe(key)||!hex(digest,64)||
     epoch<1||version<1||!new_version)return WF_INVALID;
  int a=auth(s,"accept_step",t,r,rev,epoch,version,step,key,digest,msg);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  int f=fenced(s,t,r,rev,epoch,version);if(f)return f;
  auto p=prepare(s,"INSERT INTO effects(tenant,run,step,effect_key,digest,state) VALUES(?,?,?,?,?,'prepared')");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,step);bind(p.get(),4,key);bind(p.get(),5,digest);
  int rc=step_done(p.get());p.reset();if(rc)return rc;
  auto q=prepare(s,"INSERT INTO inbox(tenant,run,message_id,step,effect_key,digest) VALUES(?,?,?,?,?,?)");
  if(!q)return WF_STORAGE_ERROR;
  bind(q.get(),1,t);bind(q.get(),2,r);bind(q.get(),3,msg);bind(q.get(),4,step);bind(q.get(),5,key);bind(q.get(),6,digest);
  rc=step_done(q.get());q.reset();if(rc)return rc;
  if(bump(s,t,r))return WF_STORAGE_ERROR;
  if(!tx.commit())return WF_STORAGE_ERROR;
  *new_version=version+1;return WF_OK;
}
int wf_claim_dispatch(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t epoch,int64_t version,const char *step,const char *key,const char *digest,
 int64_t *new_version) {
  if(!run_id(t,r,rev)||!safe(step)||!safe(key)||!hex(digest,64)||
    epoch<1||version<1||!new_version)return WF_INVALID;
  int a=auth(s,"claim_dispatch",t,r,rev,epoch,version,step,key,digest);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  int f=fenced(s,t,r,rev,epoch,version);if(f)return f;
  auto p=prepare(s,"UPDATE effects SET state='in_doubt' WHERE tenant=? AND run=? AND step=? AND effect_key=? AND digest=? AND state='prepared'");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,step);bind(p.get(),4,key);bind(p.get(),5,digest);
  if(step_done(p.get()))return WF_STORAGE_ERROR;
  if(sqlite3_changes(s->db)!=1)return WF_FENCED;
  p.reset();if(bump(s,t,r))return WF_STORAGE_ERROR;
  if(!tx.commit())return WF_STORAGE_ERROR;
  *new_version=version+1;return WF_OK;
}
int wf_reconcile(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t epoch,int64_t version,const char *step,const char *outcome,
 const char *receipt,int64_t *new_version) {
  if(!run_id(t,r,rev)||!safe(step)||!receipt_valid(receipt)||
     !outcome || (strcmp(outcome,"committed")!=0 && strcmp(outcome,"not_applied")!=0) ||
     epoch<1||version<1||!new_version)return WF_INVALID;
  int a=auth(s,"reconcile",t,r,rev,epoch,version,step,nullptr,nullptr,nullptr,outcome,receipt);if(a)return a;
  // Lookup, then verify externally WITHOUT holding any transaction lock.
  std::string key,digest;
  {
  std::lock_guard<std::mutex> lock(s->mutex);
  int f=fenced(s,t,r,rev,epoch,version);if(f)return f;
  auto q=prepare(s,"SELECT effect_key,digest FROM effects WHERE tenant=? AND run=? AND step=? AND state='in_doubt'");
  if(!q)return WF_STORAGE_ERROR;
  bind(q.get(),1,t);bind(q.get(),2,r);bind(q.get(),3,step);
  if(sqlite3_step(q.get())!=SQLITE_ROW)return WF_FENCED;
  key=(const char*)sqlite3_column_text(q.get(),0);
  digest=(const char*)sqlite3_column_text(q.get(),1);
  } // Release connection lock and statement BEFORE external verification.
  if(s->verify(s->context,t,r,rev,step,key.c_str(),digest.c_str(),outcome,receipt)!=1)return WF_UNAUTHORIZED;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  int f=fenced(s,t,r,rev,epoch,version);if(f)return f;
  auto p=prepare(s,"UPDATE effects SET state=?,receipt=? WHERE tenant=? AND run=? AND step=? AND effect_key=? AND digest=? AND state='in_doubt'");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,outcome);bind(p.get(),2,receipt);bind(p.get(),3,t);bind(p.get(),4,r);bind(p.get(),5,step);bind(p.get(),6,key.c_str());bind(p.get(),7,digest.c_str());
  int rc=step_done(p.get());if(rc)return rc;
  if(sqlite3_changes(s->db)!=1)return WF_FENCED;
  p.reset();
  auto in=prepare(s,"UPDATE inbox SET state=? WHERE tenant=? AND run=? AND step=?");
  if(!in)return WF_STORAGE_ERROR;
  bind(in.get(),1,outcome);bind(in.get(),2,t);bind(in.get(),3,r);bind(in.get(),4,step);
  if(step_done(in.get()))return WF_STORAGE_ERROR;
  in.reset();if(bump(s,t,r))return WF_STORAGE_ERROR;
  if(!tx.commit())return WF_STORAGE_ERROR;
  *new_version=version+1;return WF_OK;
}
int wf_finish(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t epoch,int64_t version,int64_t *new_version) {
  if(!run_id(t,r,rev)||epoch<1||version<1||!new_version)return WF_INVALID;
  int a=auth(s,"finish",t,r,rev,epoch,version);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s);if(!tx.active)return WF_STORAGE_ERROR;
  int f=fenced(s,t,r,rev,epoch,version);if(f)return f;
  auto c=prepare(s,"SELECT COUNT(*),SUM(CASE WHEN state='committed' THEN 1 ELSE 0 END) FROM effects WHERE tenant=? AND run=?");
  if(!c)return WF_STORAGE_ERROR;
  bind(c.get(),1,t);bind(c.get(),2,r);
  if(sqlite3_step(c.get())!=SQLITE_ROW)return WF_STORAGE_ERROR;
  int64_t all=sqlite3_column_int64(c.get(),0),done=sqlite3_column_int64(c.get(),1);
  c.reset();if(all<=0 || all!=done)return WF_FENCED;
  auto p=prepare(s,"UPDATE workflow SET phase='finished',version=version+1 WHERE tenant=? AND run=?");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);if(step_done(p.get()))return WF_STORAGE_ERROR;
  p.reset();if(!tx.commit())return WF_STORAGE_ERROR;
  *new_version=version+1;return WF_OK;
}
int wf_inspect(wf_store *s,const char *t,const char *r,const char *rev,
 int64_t *epoch,int64_t *version,int64_t *prepared,int64_t *in_doubt,
 int64_t *committed,int64_t *not_applied,int64_t *inbox_count) {
  if(!run_id(t,r,rev)||!epoch||!version||!prepared||!in_doubt||!committed||!not_applied||!inbox_count)return WF_INVALID;
  int a=auth(s,"inspect",t,r,rev,0,0);if(a)return a;
  std::lock_guard<std::mutex> lock(s->mutex);
  Tx tx(s,false);if(!tx.active)return WF_STORAGE_ERROR;
  auto p=prepare(s,"SELECT epoch,version FROM workflow WHERE tenant=? AND run=? AND revision=?");
  if(!p)return WF_STORAGE_ERROR;
  bind(p.get(),1,t);bind(p.get(),2,r);bind(p.get(),3,rev);
  if(sqlite3_step(p.get())!=SQLITE_ROW)return WF_FENCED;
  int64_t e=sqlite3_column_int64(p.get(),0),v=sqlite3_column_int64(p.get(),1);p.reset();
  auto q=prepare(s,"SELECT SUM(state='prepared'),SUM(state='in_doubt'),SUM(state='committed'),SUM(state='not_applied') FROM effects WHERE tenant=? AND run=?");
  if(!q)return WF_STORAGE_ERROR;
  bind(q.get(),1,t);bind(q.get(),2,r);
  if(sqlite3_step(q.get())!=SQLITE_ROW)return WF_STORAGE_ERROR;
  int64_t pcount=sqlite3_column_int64(q.get(),0),ucount=sqlite3_column_int64(q.get(),1),ccount=sqlite3_column_int64(q.get(),2),ncount=sqlite3_column_int64(q.get(),3);q.reset();
  auto in=prepare(s,"SELECT count(*) FROM inbox WHERE tenant=? AND run=?");
  if(!in)return WF_STORAGE_ERROR;
  bind(in.get(),1,t);bind(in.get(),2,r);if(sqlite3_step(in.get())!=SQLITE_ROW)return WF_STORAGE_ERROR;
  int64_t icount=sqlite3_column_int64(in.get(),0);in.reset();
  if(!tx.commit())return WF_STORAGE_ERROR;
  *epoch=e;*version=v;*prepared=pcount;*in_doubt=ucount;*committed=ccount;*not_applied=ncount;*inbox_count=icount;
  return WF_OK;
}
}
