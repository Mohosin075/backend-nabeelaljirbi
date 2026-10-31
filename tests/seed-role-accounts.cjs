// The caller must use phase-one-test-db.cjs, which rejects production URLs.
async function seedRoleAccounts(db) {
  for (const [index, tier] of ['SUPER_ADMIN','OPERATIONS','FINANCE','SUPPORT','READ_ONLY'].entries()) {
    const data={phoneNumber:`+21890000101${index}`,fullName:`Synthetic ${tier}`,role:'ADMIN',adminTier:tier,status:'ACTIVE',banned:false,profileCompleted:true};
    await db.user.upsert({where:{id:'phase1-role-'+tier},create:{id:'phase1-role-'+tier,...data},update:data});
  }
  await db.user.upsert({where:{id:'phase1-role-manager'},create:{id:'phase1-role-manager',phoneNumber:'+218900001019',fullName:'Synthetic booking receptionist',role:'MANAGER',status:'ACTIVE',profileCompleted:true,manager:{create:{clinicId:'phase1-clinic'}}},update:{status:'ACTIVE',banned:false}});
}
module.exports={seedRoleAccounts};
