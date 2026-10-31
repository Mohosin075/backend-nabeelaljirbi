// Actual JWT/auth/tier middleware and route stacks; synthetic accounts and no providers/DB writes.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module'),express=require('express'),jwt=require('jsonwebtoken');
const secret='synthetic-role-test-secret-not-for-deployment';
const accounts=new Map();
for(const [id,role,tier] of [['super','ADMIN','SUPER_ADMIN'],['ops','ADMIN','OPERATIONS'],['finance','ADMIN','FINANCE'],['support','ADMIN','SUPPORT'],['read','ADMIN','READ_ONLY'],['clinic','CLINIC'],['manager','MANAGER'],['doctor','DOCTOR'],['patient','PATIENT']]) accounts.set(id,{id,role,adminTier:tier,phoneNumber:'+test-'+id,status:'ACTIVE',banned:false});
accounts.set('suspended',{...accounts.get('clinic'),id:'suspended',status:'SUSPENDED'});
accounts.set('banned',{...accounts.get('clinic'),id:'banned',banned:true});
let lastWhere;
const db={user:{findFirst:async({where})=>{lastWhere=where;return where.id?accounts.get(where.id):[...accounts.values()].find(u=>u.phoneNumber===where.phoneNumber);}}};
const pass=(_req,_res,next)=>next();
const controller=new Proxy({}, {get:()=> (_req,res)=>res.json({reached:true})});
const original=Module._load;
Module._load=function(request,parent,main){
  if(request.endsWith('/shared/prisma'))return {__esModule:true,default:db};
  if(/(?:^|\/)config$/.test(request))return {__esModule:true,default:{jwt:{jwt_secret:secret}}};
  if(request.endsWith('.controller'))return new Proxy({}, {get:()=>controller});
  if(request.endsWith('/s3Bucket/fileUploadToS3'))return {s3Uploader:{single:()=>pass,fields:()=>pass}};
  if(request.endsWith('/file/fileUploader'))return {upload:{single:()=>pass}};
  if(request==='./file.upload')return {upload:{single:()=>pass}};
  return original.call(this,request,parent,main);
};
const auth=require('../src/app/middlewares/auth').default;
const routes=[['admin','Admin/admin.routes','AdminRoutes'],['clinic','Clinic/clinic.routes','ClinicRoutes'],['payment','Payment/payment.routes','PaymentRoutes'],['prepaid','PrepaidCard/prepaidCard.routes','PrepaidCardRoutes'],['referral','Referral/referral.routes','ReferralRoutes'],['user','User/user.routes','UserRoutes'],['notification','AllowNotification/allowNotification.routes','AllowNotificationRoutes'],['patient-plan','PatientPlatformSubscription/patientPlatformSubscription.routes','PatientPlatformSubscriptionRoutes'],['clinic-plan','ClinicPlatformSubscription/clinicPlatformSubscription.routes','ClinicPlatformSubscriptionRoutes'],['upload','uploadFile/upload.routes','UploadVideo']].map(([prefix,file,name])=>[prefix,require('../src/app/modules/'+file)[name]]);
Module._load=original;
let server,base;
before(async()=>{
  const app=express();app.use(express.json());
  for(const [prefix,router]of routes)app.use('/'+prefix,router);
  app.get('/clinic-only',auth('CLINIC'),(_req,res)=>res.json({ok:true}));
  app.get('/identity',auth(),(req,res)=>res.json({id:req.user.id,role:req.user.role,tier:req.user.adminTier}));
  app.post('/generic-mutation',auth(),(_req,res)=>res.json({ok:true}));
  app.use((e,_req,res,_next)=>res.status(e.statusCode||401).json({message:e.message}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
function token(id,extra={}){return jwt.sign({id,role:'ADMIN',adminTier:'SUPER_ADMIN',...extra},secret,{expiresIn:'5m'});}
async function request(path,id,method='GET',extra={}){return fetch(base+path,{method,headers:{...(id?{Authorization:'Bearer '+token(id,extra)}:{}),'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});}

test('DB role/tier wins over forged/stale token claims and only Super Admin has role override',async()=>{
  for(const id of accounts.keys())assert.equal((await request('/clinic-only',id)).status,['super','clinic'].includes(id)?200:403,id);
  const body=await(await request('/identity','patient')).json();assert.deepEqual(body,{id:'patient',role:'PATIENT',tier:null});
  assert.equal((await request('/identity','ops')).status,200);
  assert.equal((await(await request('/identity','ops')).json()).tier,'OPERATIONS');
  assert.equal((await request('/generic-mutation','read','POST')).status,403);
});
test('token ID remains authoritative after phone reassignment and missing identities fail closed',async()=>{
  assert.equal((await request('/identity','patient','GET',{phoneNumber:accounts.get('super').phoneNumber})).status,200);assert.deepEqual(lastWhere,{id:'patient'});
  assert.equal((await request('/identity','deleted','GET',{phoneNumber:accounts.get('super').phoneNumber})).status,404);
  const invalid=await fetch(base+'/identity',{headers:{Authorization:'Bearer '+jwt.sign({},secret)}});assert.equal(invalid.status,401);
  const forged=await fetch(base+'/identity',{headers:{Authorization:'Bearer '+jwt.sign({id:'super'},'wrong-test-secret')}});assert.equal(forged.status,401);
  const expired=await fetch(base+'/identity',{headers:{Authorization:'Bearer '+jwt.sign({id:'super'},secret,{expiresIn:-1})}});assert.equal(expired.status,401);
  assert.equal((await request('/identity',null)).status,401);
  const legacy=await fetch(base+'/identity',{headers:{Authorization:'Bearer '+jwt.sign({phoneNumber:accounts.get('patient').phoneNumber},secret)}});assert.equal((await legacy.json()).id,'patient');
});
test('notification and subscription mutations enforce each actual route/tier',async()=>{
  for(const [prefix,allowed]of [['notification',['super','ops']],['patient-plan',['super','finance']],['clinic-plan',['super','finance']]]){
    for(const [method,path]of [['POST',prefix==='notification'?'/':'/create-or-update'],['PATCH','/test'],['DELETE','/test']]){
      for(const id of [null,...accounts.keys()])assert.equal((await request('/'+prefix+path,id,method)).status,id===null?401:allowed.includes(id)?200:403,`${prefix} ${method} ${id}`);
    }
    assert.equal((await request('/'+prefix+'/',null)).status,200,'public configuration reads remain usable');
  }
});
test('patient directory, status and arbitrary private-file signing are protected',async()=>{
  for(const id of [null,...accounts.keys()]){
    assert.equal((await request('/user/',id)).status,id===null?401:['super','ops','support','read'].includes(id)?200:403,'directory '+id);
    assert.equal((await request('/user/update-status/example',id,'PATCH')).status,id===null?401:['super','ops'].includes(id)?200:403,'status '+id);
    assert.equal((await request('/upload/private-file-url',id,'POST')).status,id===null?401:id==='super'?200:403,'private signing '+id);
  }
  assert.equal((await request('/upload/file',null,'POST')).status,401);
});
test('actual Admin routes separate operations, finance, support and read-only mutations',async()=>{
  for(const [path,method,allowed] of [['/admin/doctor-verified/x','PATCH',['super','ops']],['/admin/update-wallet','PATCH',['super','finance']],['/admin/complaints/x/resolve','PATCH',['super','ops','support']],['/admin/staff','POST',['super']],['/admin/financial-overview','GET',['super','finance','read']]]){
    for(const id of accounts.keys())assert.equal((await request(path,id,method)).status,allowed.includes(id)?200:403,`${path} ${id}`);
  }
});
test('social identity requires verified ownership of the exact phone',async()=>{
  const {verifySocialPhone}=require('../src/app/modules/User/socialIdentity');
  let calls=0;const verify=async()=>{calls++;return{phone_number:'+218123'};};
  await assert.rejects(verifySocialPhone({phoneNumber:'+218123'},verify),/identity token/);assert.equal(calls,0);
  await assert.rejects(verifySocialPhone({phoneNumber:'+218999',idToken:'test'},verify),/requested phone/);
  await assert.rejects(verifySocialPhone({phoneNumber:'+218123',idToken:'test'},async()=>{throw Error('expired');}),/verification failed/);
  await assert.rejects(verifySocialPhone({phoneNumber:'+218123',idToken:'test'},async()=>({})),/requested phone/);
  assert.equal(await verifySocialPhone({phoneNumber:'+218123',idToken:'test'},verify),'+218123');
});
test('shared clinic finance/report endpoints explicitly admit authorized admin tiers and reject receptionists',async()=>{
  for(const [path,allowed] of [['reconciliation-reports',['super','ops','finance','read','clinic']],['financial-summary',['super','finance','read','clinic']],['settlements',['super','finance','read','clinic']]])for(const id of accounts.keys())assert.equal((await request('/clinic/'+path,id)).status,allowed.includes(id)?200:403,path+' '+id);
});
test('receptionists cannot access legacy money, card redemption or referral endpoints',async()=>{
  for(const [path,method]of [['/payment/top-up-history','GET'],['/payment/withdraw-history','GET'],['/payment/withdraw-payment','POST'],['/payment/patient-top-up','POST'],['/prepaid/top-up','POST'],['/referral/claim-bonus','POST']])assert.equal((await request(path,'manager',method)).status,403,path);
  assert.equal((await request('/payment/top-up-history','patient')).status,200);
  assert.equal((await request('/payment/top-up-history','finance')).status,200);
  assert.equal((await request('/payment/top-up-history','ops')).status,403);
});

test('real OTP login rejects universal codes and inactive accounts, but preserves verified login',async()=>{
  let current={...accounts.get('patient'),otp:'987654',otpExpiresAt:new Date(Date.now()+60000)},writes=0,approved=false;
  const config={env:'production',jwt:{jwt_secret:secret,expires_in:'5m',refresh_token_secret:secret+'refresh',refresh_token_expires_in:'10m'},twilio:{accountSid:'synthetic',authToken:'synthetic',serviceSid:'synthetic'}};
  const beforeLoad=Module._load;
  Module._load=function(request,parent,main){
    if(request.endsWith('/shared/prisma'))return{__esModule:true,default:{user:{findUnique:async()=>current,update:async()=>{writes++;return current;}}}};
    if(/(?:^|\/)config$/.test(request))return{__esModule:true,default:config};
    if(request==='twilio')return{__esModule:true,default:()=>({verify:{v2:{services:()=>({verificationChecks:{create:async()=>({status:approved?'approved':'pending'})}})}}})};
    if(request.endsWith('/emailSender/emailSender'))return{__esModule:true,default:async()=>{}};
    return beforeLoad.call(this,request,parent,main);
  };
  let service;try{service=require('../src/app/modules/Auth/auth.service').AuthServices;}finally{Module._load=beforeLoad;}
  const old=process.env.NODE_ENV;
  try{
    delete process.env.NODE_ENV;
    await assert.rejects(service.verifyUserByOTP(current.phoneNumber,'123456'),/Invalid or expired/);assert.equal(writes,0);
    config.env='development';process.env.NODE_ENV='development';
    await assert.rejects(service.verifyUserByOTP(current.phoneNumber,'123456'),/Invalid or expired/);assert.equal(writes,0);
    const valid=await service.verifyUserByOTP(current.phoneNumber,'987654');assert.equal(jwt.verify(valid.accessToken,secret).id,current.id);assert.equal(writes,1);
    current={...current,status:'SUSPENDED'};
    await assert.rejects(service.verifyUserByOTP(current.phoneNumber,'987654'),/inactive/);assert.equal(writes,1);
    current={...current,status:'ACTIVE',otp:null};approved=true;
    assert.equal((await service.verifyUserByOTP(current.phoneNumber,'654321')).role,'PATIENT');assert.equal(writes,2);
  }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});

test('legacy user status and social service cannot bypass admin-account or identity checks',async()=>{
  const beforeLoad=Module._load;let writes=0;
  Module._load=function(request,parent,main){
    if(request.endsWith('/shared/prisma'))return{__esModule:true,default:{user:{findUnique:async()=>accounts.get('super'),update:async()=>{writes++;}}}};
    if(request.endsWith('/helpars/stripe/stripe'))return{__esModule:true,default:{}};
    if(request.endsWith('/emailSender/emailSender'))return{__esModule:true,default:async()=>{}};
    return beforeLoad.call(this,request,parent,main);
  };
  let service;try{service=require('../src/app/modules/User/user.service').UserService;}finally{Module._load=beforeLoad;}
  await assert.rejects(service.updateStatus('super','SUSPENDED'),/Super Admin staff controls/);
  await assert.rejects(service.createSocialUser({phoneNumber:accounts.get('super').phoneNumber}),/identity token/);
  assert.equal(writes,0);
});
