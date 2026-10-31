// The caller must use phase-one-test-db.cjs, which rejects production URLs.
async function seedRoleAccounts(db) {
  for (const [index, tier] of ['SUPER_ADMIN','OPERATIONS','FINANCE','SUPPORT','READ_ONLY'].entries()) {
    const data={phoneNumber:`+21890000101${index}`,fullName:`Synthetic ${tier}`,role:'ADMIN',adminTier:tier,status:'ACTIVE',banned:false,profileCompleted:true};
    await db.user.upsert({where:{id:'phase1-role-'+tier},create:{id:'phase1-role-'+tier,...data},update:data});
  }
  await db.user.upsert({where:{id:'phase1-role-manager'},create:{id:'phase1-role-manager',phoneNumber:'+218900001019',fullName:'Synthetic booking receptionist',role:'MANAGER',status:'ACTIVE',profileCompleted:true,manager:{create:{clinicId:'phase1-clinic'}}},update:{status:'ACTIVE',banned:false}});
  await db.user.upsert({where:{id:'phase1-flow-patient-user'},create:{id:'phase1-flow-patient-user',phoneNumber:'+218900001031',fullName:'Browser booking patient',role:'PATIENT',wallet:1000,profileCompleted:true,patient:{create:{id:'phase1-flow-patient'}}},update:{}});
  await db.user.upsert({where:{id:'phase1-flow-clinic-user'},create:{id:'phase1-flow-clinic-user',phoneNumber:'+218900001032',fullName:'Browser booking clinic',country:'LIBYA',role:'CLINIC',wallet:1000,profileCompleted:true,clinic:{create:{id:'phase1-flow-clinic',clinicName:'Browser full flow clinic',collectionMode:'MODE_B',adminVerified:true,isVisible:true,trial:false,timezone:'Etc/UTC'}}},update:{}});
  await db.user.upsert({where:{id:'phase1-flow-manager'},create:{id:'phase1-flow-manager',phoneNumber:'+218900001033',role:'MANAGER',profileCompleted:true,manager:{create:{clinicId:'phase1-flow-clinic'}}},update:{}});
  await db.doctorClinic.upsert({where:{doctorId_clinicId:{doctorId:'phase1-doctor',clinicId:'phase1-flow-clinic'}},create:{doctorId:'phase1-doctor',clinicId:'phase1-flow-clinic'},update:{isActive:true}});
  const date=new Date(Date.now()+3600000);if(date.getUTCHours()===23&&date.getUTCMinutes()===59)date.setUTCMinutes(58);
  const day=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][date.getUTCDay()];
  const working=await db.workingDay.upsert({where:{id:'phase1-flow-working-day'},create:{id:'phase1-flow-working-day',doctorId:'phase1-doctor',clinicId:'phase1-flow-clinic',day},update:{day}});
  const startTime=date.toISOString().slice(11,16);
  const slot=await db.workingSlot.upsert({where:{id:'phase1-flow-working-slot'},create:{id:'phase1-flow-working-slot',workingDayId:working.id,startTime,endTime:'23:59',capacity:20},update:{startTime}});
  return{clinicId:'phase1-flow-clinic',doctorId:'phase1-doctor',workingSlotId:slot.id,consultDate:date.toISOString().slice(0,10)};
}
module.exports={seedRoleAccounts};
