INSERT INTO users (id,"phoneNumber",role,"fullName",country,wallet,"frozenWallet","profileCompleted","updatedAt") VALUES
('phase1-admin','+218900000001','ADMIN','Test Admin','LIBYA',0,0,true,NOW()),
('phase1-clinic-user','+218900000002','CLINIC','Test Clinic Owner','LIBYA',200,5,true,NOW()),
('phase1-doctor-user','+218900000003','DOCTOR','Test Doctor','LIBYA',50,2,true,NOW()),
('phase1-patient-user','+218900000004','PATIENT','Test Patient','TUNISIA',500,10,true,NOW()),
('phase1-other-clinic-user','+218900000005','CLINIC','Other Clinic','LIBYA',100,0,true,NOW());
INSERT INTO clinics (id,"userId","clinicName","adminVerified","updatedAt") VALUES
('phase1-clinic','phase1-clinic-user','Test Clinic',true,NOW()),
('phase1-other-clinic','phase1-other-clinic-user','Other Clinic',true,NOW());
INSERT INTO doctors (id,"userId","consultFee","adminVerified","updatedAt") VALUES ('phase1-doctor','phase1-doctor-user',75.50,true,NOW());
INSERT INTO patients (id,"userId","updatedAt") VALUES ('phase1-patient','phase1-patient-user',NOW());
INSERT INTO doctor_clinics (id,"doctorId","clinicId","updatedAt") VALUES ('phase1-link','phase1-doctor','phase1-clinic',NOW());
INSERT INTO booking_appointments (id,"clinicId","doctorId","patientId","consultDate","serialNumber","consultFee","serviceFeeAmount","totalAmount","updatedAt") VALUES
('phase1-legacy-booking','phase1-clinic','phase1-doctor','phase1-patient',NOW()+INTERVAL '1 day',1,75.50,7.55,83.05,NOW());
-- Migration stress fixture: historical statuses and amounts must stay unchanged.
INSERT INTO booking_appointments (id,"clinicId","doctorId","patientId","consultDate","serialNumber","consultFee","serviceFeeAmount","totalAmount",status,"updatedAt")
SELECT 'phase1-volume-' || n, 'phase1-other-clinic', 'phase1-doctor', 'phase1-patient', NOW()-INTERVAL '30 days', n, 75.50, 7.55, 83.05,
       (ARRAY['COMPLETE','CANCELLED','NOT_SHOW','REJECTED'])[1+(n%4)]::"BookingStatus", NOW()
FROM generate_series(1,1000) AS n;
INSERT INTO top_ups (id,"userId",amount,type,"updatedAt") VALUES
('phase1-legacy-journal-1','phase1-clinic-user',200,'RECHARGE',NOW()),
('phase1-legacy-journal-2','phase1-doctor-user',50,'RECHARGE',NOW()),
('phase1-legacy-journal-3','phase1-patient-user',500,'RECHARGE',NOW());
INSERT INTO settlements (id,"settlementNumber","partyType","clinicId",amount,status,reference,"receiptUrl","updatedAt") VALUES
('phase1-legacy-settlement','SET-LEGACY-SYNTHETIC','CLINIC','phase1-clinic',40,'COMPLETED','LEGACY-REFERENCE','https://example.test/legacy-receipt.pdf',NOW());
CREATE TABLE phase1_legacy_snapshot AS SELECT id, wallet, "frozenWallet", "phoneNumber" FROM users;
CREATE TABLE phase1_booking_snapshot AS SELECT id, "consultFee", "serviceFeeAmount", "totalAmount", status FROM booking_appointments;
