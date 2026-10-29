// JNI host binding for the stable wf_* C ABI. No Oreslang guest FFI claimed.
#include "workflow_sqlite.h"
#include <jni.h>
#include <cstdint>
#include <memory>
#include <initializer_list>

namespace {
struct Host {
  JavaVM *vm = nullptr;
  jobject policy = nullptr; // GlobalRef, owned until wf_close completes
  wf_store *store = nullptr;
};
struct Str {
  JNIEnv *env;
  jstring value;
  const char *chars;
  Str(JNIEnv *e, jstring v):env(e),value(v),chars(v ? e->GetStringUTFChars(v,nullptr) : nullptr) {}
  ~Str(){if(chars) env->ReleaseStringUTFChars(value,chars);}
  Str(const Str&)=delete;
  Str& operator=(const Str&)=delete;
};
Host *as_host(jlong h) { return reinterpret_cast<Host*>(static_cast<intptr_t>(h)); }
int callback(Host *h, bool receipt, const char *action,
             const char *tenant,const char *run,const char *revision,
             int64_t epoch,int64_t version,const char *step,const char *key,
             const char *digest,const char *message_id,const char *outcome,const char *proof) {
  if(!h || !h->vm || !h->policy) return 0;
  JNIEnv *env=nullptr;
  bool attached=false;
  jint rc=h->vm->GetEnv(reinterpret_cast<void**>(&env),JNI_VERSION_1_8);
  if(rc==JNI_EDETACHED) {
    if(h->vm->AttachCurrentThread(reinterpret_cast<void**>(&env),nullptr)!=JNI_OK)return 0;
    attached=true;
  } else if(rc!=JNI_OK)return 0;
  auto finish=[&](int allowed)->int {
    if(env->ExceptionCheck()){env->ExceptionClear();allowed=0;}
    if(attached)h->vm->DetachCurrentThread();
    return allowed;
  };
  const char *fields[10]={action,tenant,run,revision,step,key,digest,message_id,outcome,proof};
  jclass stringClass=env->FindClass("java/lang/String");
  if(!stringClass)return finish(0);
  jobjectArray array=env->NewObjectArray(10,stringClass,nullptr);
  env->DeleteLocalRef(stringClass);
  if(!array)return finish(0);
  for(int i=0;i<10;i++) {
    if(!fields[i])continue;
    jstring item=env->NewStringUTF(fields[i]);
    if(!item){env->DeleteLocalRef(array);return finish(0);}
    env->SetObjectArrayElement(array,i,item);
    env->DeleteLocalRef(item);
    if(env->ExceptionCheck()){env->DeleteLocalRef(array);return finish(0);}
  }
  jclass pc=env->GetObjectClass(h->policy);
  if(!pc){env->DeleteLocalRef(array);return finish(0);}
  jmethodID method=env->GetMethodID(pc,receipt ? "verifyNative":"authorizeNative",
                                   receipt ? "([Ljava/lang/String;)Z":"([Ljava/lang/String;JJ)Z");
  env->DeleteLocalRef(pc);
  if(!method){env->DeleteLocalRef(array);return finish(0);}
  jboolean allowed=receipt ? env->CallBooleanMethod(h->policy,method,array)
    : env->CallBooleanMethod(h->policy,method,array,(jlong)epoch,(jlong)version);
  env->DeleteLocalRef(array);
  return finish(allowed==JNI_TRUE ? 1:0);
}
int authorize(void *ctx,const char *action,const char *tenant,const char *run,
 const char *revision,int64_t epoch,int64_t version,const char *step,
 const char *key,const char *digest,const char *message_id,
 const char *outcome,const char *receipt) {
  return callback(static_cast<Host*>(ctx),false,action,tenant,run,revision,
                  epoch,version,step,key,digest,message_id,outcome,receipt);
}
int verify(void *ctx,const char *tenant,const char *run,const char *revision,
 const char *step,const char *key,const char *digest,
 const char *outcome,const char *receipt) {
  return callback(static_cast<Host*>(ctx),true,"verify_receipt",tenant,run,revision,
                  0,0,step,key,digest,nullptr,outcome,receipt);
}
jlongArray response(JNIEnv *env, int status, std::initializer_list<int64_t> values) {
  jlongArray out=env->NewLongArray(static_cast<jsize>(1+values.size()));
  if(!out)return nullptr;
  jlong entries[8]{};entries[0]=status;
  int i=1;for(auto value:values)entries[i++]=static_cast<jlong>(value);
  env->SetLongArrayRegion(out,0,static_cast<jsize>(1+values.size()),entries);
  return out;
}
}
extern "C" {
JNIEXPORT jlong JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeOpen
(JNIEnv *env,jclass,jstring directory,jobject policy) {
  if(!directory||!policy)return 0;
  Str path(env,directory);
  if(!path.chars)return 0;
  std::unique_ptr<Host> host(new Host);
  if(env->GetJavaVM(&host->vm)!=JNI_OK)return 0;
  host->policy=env->NewGlobalRef(policy);
  if(!host->policy)return 0;
  int status=wf_open(path.chars,authorize,verify,host.get(),&host->store);
  if(status!=WF_OK){env->DeleteGlobalRef(host->policy);return 0;}
  return static_cast<jlong>(reinterpret_cast<intptr_t>(host.release()));
}
JNIEXPORT void JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeClose
(JNIEnv *env,jclass,jlong handle) {
  std::unique_ptr<Host> h(as_host(handle));
  if(h){ wf_close(h->store);env->DeleteGlobalRef(h->policy); }
}
JNIEXPORT jint JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeCreateRun
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision) {
  Str t(env,tenant),r(env,run),v(env,revision);auto h=as_host(handle);
  return h ? wf_create_run(h->store,t.chars,r.chars,v.chars) : WF_INVALID;
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeActivate
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision,jlong expected) {
  Str t(env,tenant),r(env,run),v(env,revision);auto h=as_host(handle);
  int64_t epoch=0,version=0;int status=h?wf_activate(h->store,t.chars,r.chars,v.chars,expected,&epoch,&version):WF_INVALID;
  return response(env,status,{epoch,version});
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeAcceptStep
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision,
 jlong epoch,jlong version,jstring step,jstring message,jstring key,jstring digest) {
  Str t(env,tenant),r(env,run),v(env,revision),s(env,step),m(env,message),k(env,key),d(env,digest);
  auto h=as_host(handle);int64_t new_version=0;
  int status=h?wf_accept_step(h->store,t.chars,r.chars,v.chars,epoch,version,
              s.chars,m.chars,k.chars,d.chars,&new_version):WF_INVALID;
  return response(env,status,{new_version});
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeClaimDispatch
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision,
 jlong epoch,jlong version,jstring step,jstring key,jstring digest) {
  Str t(env,tenant),r(env,run),v(env,revision),s(env,step),k(env,key),d(env,digest);
  auto h=as_host(handle);int64_t new_version=0;
  int status=h?wf_claim_dispatch(h->store,t.chars,r.chars,v.chars,epoch,version,
              s.chars,k.chars,d.chars,&new_version):WF_INVALID;
  return response(env,status,{new_version});
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeReconcile
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision,
 jlong epoch,jlong version,jstring step,jstring outcome,jstring receipt) {
  Str t(env,tenant),r(env,run),v(env,revision),s(env,step),o(env,outcome),p(env,receipt);
  auto h=as_host(handle);int64_t new_version=0;
  int status=h?wf_reconcile(h->store,t.chars,r.chars,v.chars,epoch,version,
              s.chars,o.chars,p.chars,&new_version):WF_INVALID;
  return response(env,status,{new_version});
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeFinish
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision,jlong epoch,jlong version) {
  Str t(env,tenant),r(env,run),v(env,revision);auto h=as_host(handle);int64_t new_version=0;
  int status=h?wf_finish(h->store,t.chars,r.chars,v.chars,epoch,version,&new_version):WF_INVALID;
  return response(env,status,{new_version});
}
JNIEXPORT jlongArray JNICALL Java_dev_oreslang_workflow_NativeWorkflowStore_nativeInspect
(JNIEnv *env,jclass,jlong handle,jstring tenant,jstring run,jstring revision) {
  Str t(env,tenant),r(env,run),v(env,revision);auto h=as_host(handle);
  int64_t epoch=0,version=0,prepared=0,in_doubt=0,committed=0,not_applied=0,inbox=0;
  int status=h?wf_inspect(h->store,t.chars,r.chars,v.chars,&epoch,&version,
                          &prepared,&in_doubt,&committed,&not_applied,&inbox):WF_INVALID;
  return response(env,status,{epoch,version,prepared,in_doubt,committed,not_applied,inbox});
}
}
