#include "workflow_sqlite.h"
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <stdexcept>
#include <iostream>
#include <fstream>

#define CHECK(expr) do { if(!(expr)) {std::cerr << "FAILED " << #expr << " line " << __LINE__ << '\n';std::exit(1);} } while(0)
static const char *rev="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char *digest="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
struct Ctx { bool allowed=true;bool verified=true;std::string remote;bool rotate=false;std::string dir;};
static int authorize(void *p,const char *,const char *,const char *,const char *,int64_t,int64_t,
 const char *,const char *,const char *,const char *,const char *,const char *) {return ((Ctx*)p)->allowed?1:0;}
static int verify(void *p,const char *t,const char *r,const char *revision,
 const char *step,const char *key,const char *d,const char *outcome,const char *receipt) {
 auto *ctx=(Ctx*)p;
 if(ctx->rotate){
   ctx->rotate=false;
   wf_store *other=nullptr;CHECK(wf_open(ctx->dir.c_str(),authorize,verify,ctx,&other)==WF_OK);
   int64_t e=0,v=0;CHECK(wf_activate(other,t,r,revision,1,&e,&v)==WF_OK);
   CHECK(e==2);wf_close(other);
 }
 if(!ctx->verified || strcmp(t,"tenant-a")!=0 || strcmp(r,"run-a")!=0 ||
   strcmp(revision,rev)!=0 || strcmp(step,"step-1")!=0 ||
   strcmp(key,"key-1")!=0 || strcmp(d,digest)!=0 ||
   strcmp(outcome,"committed")!=0 || strcmp(receipt,"receipt-1")!=0)return 0;
 if(!ctx->remote.empty()){
   std::ifstream f(ctx->remote);std::string line;std::getline(f,line);
   return f.good() || f.eof() ? (line=="key-1|"+std::string(digest)+"|receipt-1") : 0;
 }
 return 1;
}
static std::string dir() {
 char pattern[]="/tmp/ores-workflow-native-XXXXXX";
 char *p=mkdtemp(pattern);CHECK(p!=nullptr);return p;
}
static wf_store *open(Ctx &c){wf_store *s=nullptr;CHECK(wf_open(c.dir.c_str(),authorize,verify,&c,&s)==WF_OK);return s;}
static void snapshot(wf_store *s,int64_t e,int64_t v,int64_t prepared,int64_t unknown,int64_t committed,int64_t not_applied,int64_t inbox) {
 int64_t a,b,c,d,f,g,h;CHECK(wf_inspect(s,"tenant-a","run-a",rev,&a,&b,&c,&d,&f,&g,&h)==WF_OK);
 CHECK(a==e&&b==v&&c==prepared&&d==unknown&&f==committed&&g==not_applied&&h==inbox);
}
static void seed(wf_store *s,int64_t &e,int64_t &v){
 CHECK(wf_create_run(s,"tenant-a","run-a",rev)==WF_OK);
 CHECK(wf_activate(s,"tenant-a","run-a",rev,0,&e,&v)==WF_OK);
 CHECK(e==1 && v==1);
}
static void accept(wf_store *s,int64_t e,int64_t v,int64_t &next){
 CHECK(wf_accept_step(s,"tenant-a","run-a",rev,e,v,"step-1","msg-1","key-1",digest,&next)==WF_OK);
 CHECK(next==v+1);
}
static void claim(wf_store *s,int64_t e,int64_t v,int64_t &next){
 CHECK(wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next)==WF_OK);
 CHECK(next==v+1);
}
static void test_atomic_and_replay() {
 Ctx c; c.dir=dir();wf_store *s=open(c);int64_t e,v,next;
 CHECK(wf_create_run(s,"tenant-b","run-a",rev)==WF_OK);
 c.allowed=false;CHECK(wf_create_run(s,"other","run",rev)==WF_UNAUTHORIZED);
 c.allowed=true;seed(s,e,v);accept(s,e,v,next);v=next;snapshot(s,e,v,1,0,0,0,1);
 CHECK(wf_accept_step(s,"tenant-a","run-a",rev,e,v,"step-2","msg-1","key-2",digest,&next)==WF_DUPLICATE);
 CHECK(wf_accept_step(s,"tenant-a","run-a",rev,e,v,"step-1","msg-2","key-2",digest,&next)==WF_DUPLICATE);
 CHECK(wf_accept_step(s,"tenant-a","run-a",rev,e,v,"step-2","msg-2","key-1",digest,&next)==WF_DUPLICATE);
 snapshot(s,e,v,1,0,0,0,1);
 CHECK(wf_claim_dispatch(s,"tenant-b","run-a",rev,e,v,"step-1","key-1",digest,&next)==WF_FENCED);
 claim(s,e,v,next);v=next;snapshot(s,e,v,0,1,0,0,1);
 CHECK(wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next)==WF_FENCED);
 CHECK(wf_finish(s,"tenant-a","run-a",rev,e,v,&next)==WF_FENCED);
 c.verified=false;CHECK(wf_reconcile(s,"tenant-a","run-a",rev,e,v,"step-1","committed","receipt-1",&next)==WF_UNAUTHORIZED);
 c.verified=true;CHECK(wf_reconcile(s,"tenant-a","run-a",rev,e,v,"step-1","committed","receipt-1",&next)==WF_OK);
