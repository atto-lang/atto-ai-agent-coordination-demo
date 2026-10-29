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
#include <thread>

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
 v=next;snapshot(s,e,v,0,0,1,0,1);
 CHECK(wf_reconcile(s,"tenant-a","run-a",rev,e,v,"step-1","committed","receipt-1",&next)==WF_FENCED);
 CHECK(wf_finish(s,"tenant-a","run-a",rev,e,v,&next)==WF_OK);
 snapshot(s,e,next,0,0,1,0,1);
 CHECK(wf_activate(s,"tenant-a","run-a",rev,e,&e,&v)==WF_FENCED);
 wf_close(s);std::cout<<"native-sqlite atomic+replay PASS\n";
}
static void test_epoch_during_verification() {
 Ctx c;c.dir=dir();wf_store *s=open(c);int64_t e,v,next;
 seed(s,e,v);accept(s,e,v,next);v=next;claim(s,e,v,next);v=next;
 c.rotate=true;
 CHECK(wf_reconcile(s,"tenant-a","run-a",rev,e,v,"step-1","committed","receipt-1",&next)==WF_FENCED);
 snapshot(s,2,v+1,0,1,0,0,1);
 CHECK(wf_reconcile(s,"tenant-a","run-a",rev,2,v+1,"step-1","committed","receipt-1",&next)==WF_OK);
 snapshot(s,2,next,0,0,1,0,1);
 wf_close(s);std::cout<<"native-sqlite external-verify-CAS PASS\n";
}
static void test_sigkill() {
 Ctx c;c.dir=dir();c.remote=c.dir+"/external.txt";
 pid_t pid=fork();CHECK(pid>=0);
 if(pid==0){
   wf_store *s=open(c);int64_t e,v,next;
   seed(s,e,v);accept(s,e,v,next);v=next;claim(s,e,v,next);
   int fd=::open(c.remote.c_str(),O_CREAT|O_EXCL|O_WRONLY,0600);CHECK(fd>=0);
   std::string proof="key-1|"+std::string(digest)+"|receipt-1\n";
   CHECK(write(fd,proof.c_str(),proof.size())==(ssize_t)proof.size());
   CHECK(fsync(fd)==0);CHECK(close(fd)==0);
   kill(getpid(),SIGKILL);_exit(99);
 }
 int status;CHECK(waitpid(pid,&status,0)==pid);CHECK(WIFSIGNALED(status));CHECK(WTERMSIG(status)==SIGKILL);
 wf_store *s=open(c);snapshot(s,1,3,0,1,0,0,1);
 int64_t e=0,v=0,next;
 CHECK(wf_activate(s,"tenant-a","run-a",rev,1,&e,&v)==WF_OK);
 CHECK(e==2 && v==4);
 CHECK(wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next)==WF_FENCED);
 CHECK(wf_reconcile(s,"tenant-a","run-a",rev,e,v,"step-1","committed","receipt-1",&next)==WF_OK);
 CHECK(wf_finish(s,"tenant-a","run-a",rev,e,next,&v)==WF_OK);
 wf_close(s);
 std::ifstream file(c.remote);std::string proof;std::getline(file,proof);
 CHECK(proof=="key-1|"+std::string(digest)+"|receipt-1");
 std::cout<<"native-sqlite SIGKILL-recovery PASS\n";
}
static void test_claim_race() {
 Ctx c;c.dir=dir();wf_store *s=open(c);int64_t e,v,next;
 seed(s,e,v);accept(s,e,v,next);v=next;wf_close(s);
 int syncpipe[2];CHECK(pipe(syncpipe)==0);
 pid_t children[2]{};
 for(int i=0;i<2;i++){
  children[i]=fork();CHECK(children[i]>=0);
  if(children[i]==0){
    close(syncpipe[1]);char tick;CHECK(read(syncpipe[0],&tick,1)==1);
    wf_store *local=open(c);int64_t n=0;
    int rc=wf_claim_dispatch(local,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&n);
    wf_close(local);_exit(rc==WF_OK?0:rc==WF_FENCED?7:9);
  }
 }
 close(syncpipe[0]);CHECK(write(syncpipe[1],"xx",2)==2);close(syncpipe[1]);
 int successes=0,fenced=0;
 for(pid_t p:children){int status;CHECK(waitpid(p,&status,0)==p&&WIFEXITED(status));
    if(WEXITSTATUS(status)==0)successes++;else if(WEXITSTATUS(status)==7)fenced++;else {std::cerr<<"child status "<<WEXITSTATUS(status)<<"\n";CHECK(false);}}
 CHECK(successes==1 && fenced==1);
 s=open(c);snapshot(s,e,v+1,0,1,0,0,1);wf_close(s);
 std::cout<<"native-sqlite two-process-claim PASS\n";
}
static void test_unsafe_path() {
 Ctx c;c.dir=dir();std::string target=c.dir+"/target",link=c.dir+"/workflow-native.sqlite";
 {std::ofstream f(target);f<<"untouched";}
 CHECK(symlink(target.c_str(),link.c_str())==0);
 wf_store *s=nullptr;CHECK(wf_open(c.dir.c_str(),authorize,verify,&c,&s)==WF_INVALID);
 CHECK(s==nullptr);std::ifstream f(target);std::string data;f>>data;CHECK(data=="untouched");
 std::cout<<"native-sqlite symlink-refusal PASS\n";
}
static void test_killed_before_external_dispatch() {
 Ctx c;c.dir=dir();pid_t child=fork();CHECK(child>=0);
 if(child==0){
   wf_store *s=open(c);int64_t e,v,n;
   seed(s,e,v);accept(s,e,v,n);v=n;claim(s,e,v,n);
   kill(getpid(),SIGKILL);_exit(99);
 }
 int status;CHECK(waitpid(child,&status,0)==child && WIFSIGNALED(status) && WTERMSIG(status)==SIGKILL);
 wf_store *s=open(c);snapshot(s,1,3,0,1,0,0,1);
 int64_t e=0,v=0,next;
 CHECK(wf_activate(s,"tenant-a","run-a",rev,1,&e,&v)==WF_OK);
 CHECK(wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next)==WF_FENCED);
 CHECK(wf_finish(s,"tenant-a","run-a",rev,e,v,&next)==WF_FENCED);
 wf_close(s);std::cout<<"native-sqlite SIGKILL-before-dispatch PASS\n";
}
static void test_same_handle_thread_race() {
 Ctx c;c.dir=dir();wf_store *s=open(c);int64_t e,v,n;
 seed(s,e,v);accept(s,e,v,n);v=n;
 int rc1=99,rc2=99;
 std::thread one([&]{int64_t next;rc1=wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next);});
 std::thread two([&]{int64_t next;rc2=wf_claim_dispatch(s,"tenant-a","run-a",rev,e,v,"step-1","key-1",digest,&next);});
 one.join();two.join();
 CHECK((rc1==WF_OK && rc2==WF_FENCED)||(rc2==WF_OK && rc1==WF_FENCED));
 snapshot(s,e,v+1,0,1,0,0,1);wf_close(s);
 std::cout<<"native-sqlite same-handle-thread-fence PASS\n";
}
int main(){
 Ctx c;c.dir=dir();wf_store *s=nullptr;
 CHECK(wf_open(c.dir.c_str(),nullptr,verify,&c,&s)==WF_INVALID);
 CHECK(wf_open(c.dir.c_str(),authorize,nullptr,&c,&s)==WF_INVALID);
 test_atomic_and_replay();test_epoch_during_verification();test_sigkill();test_claim_race();test_unsafe_path();
 test_killed_before_external_dispatch();test_same_handle_thread_race();
 std::cout<<"NATIVE_SQLITE_RESULT passed=true cases=7 scope=host-C++-SQLite-not-Oreslang-guest\n";
}
