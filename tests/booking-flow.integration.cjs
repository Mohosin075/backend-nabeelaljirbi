const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  Module = require("node:module");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: require("./phase-one-test-db.cjs").testUrl } },
});
const workers = new Map(),
  scheduled = [];
const noop = new Proxy({}, { get: () => async () => undefined });
const originalLoad = Module._load;
Module._load = function (request, parent, main) {
  if (request.endsWith("/shared/prisma"))
    return { __esModule: true, default: db };
  if (request.endsWith("/bookingScheduler.service"))
    return {
      BookingSchedulerService: new Proxy(
        {},
        {
          get:
            (_, method) =>
            async (...args) => {
              scheduled.push({ method, args });
            },
        },
      ),
    };
  if (request.endsWith("/notification.service")) return { Notification: noop };
  if (request.endsWith("/notificationTemplate.service"))
    return {
      NotificationTemplateService: {
        renderNotification: async () => ({
          title: "Synthetic booking update",
          body: "Synthetic lifecycle notification",
          pushEnabled: false,
        }),
      },
    };
  if (request.endsWith("/socketHandler"))
    return { broadcastBookingUpdate() {} };
  if (request.endsWith("/Auth/auth.service"))
    return { generateTokens: () => ({ accessToken: "synthetic" }) };
  if (request.endsWith("/firebase/firebase"))
    return {
      __esModule: true,
      default: { messaging: () => ({ send: async () => {} }) },
    };
  if (request.endsWith("/redisServer")) return { redis: {} };
  if (request.endsWith("/s3Bucket/fileUploadToS3"))
    return {
      fileUploadToS3: async () => {
        throw Error("Uploads are outside this test");
      },
    };
  if (request === "bullmq")
    return {
      Worker: class {
        constructor(name, handler) {
          workers.set(name, handler);
        }
        on() {
          return this;
        }
        async close() {}
      },
    };
  return originalLoad.call(this, request, parent, main);
};
const {
  BookingService,
} = require("../src/app/modules/Booking/booking.service");
const { ClinicService } = require("../src/app/modules/Clinic/clinic.service");
const {
  PatientController,
} = require("../src/app/modules/Patient/patient.controller");
require("../src/app/jobs/workers/bookingWorker");
Module._load = originalLoad;
const {
  historyOperations,
} = require("../src/app/modules/PhaseOne/history.operations");
const {
  bookingOperations,
} = require("../src/app/modules/PhaseOne/booking.operations");
const { getAppointmentStartUTC } = require("../src/utils/timezoneHelper");
const history = historyOperations(db),
  ops = bookingOperations(db, {
    transition: ClinicService.updateAppointmentStatus,
    cancel: BookingService.cancelBooking,
  });
let admin, server, base;
const oldAdminPhone = process.env.ADMIN_PHONE_NUMBER;
before(async () => {
  process.env.ADMIN_PHONE_NUMBER = "synthetic-nonexistent-admin-phone";
  admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  assert.ok(admin);
  const express = require("express"),
    app = express();
  app.use(express.json());
  const validate = require("../src/app/middlewares/validateRequest").default;
  const {
    bookingValidation,
  } = require("../src/app/modules/Booking/booking.validation");
  app.post(
    "/patient/appointment-booking",
    async (req, res, next) => {
      const user = await db.user.findUnique({
        where: { id: String(req.headers.authorization || "") },
      });
      if (
        !user ||
        user.role !== "PATIENT" ||
        user.status !== "ACTIVE" ||
        user.banned
      )
        return res.status(403).json({ message: "Patient required" });
      req.user = user;
      next();
    },
    validate(bookingValidation.createBookingValidationSchema),
    PatientController.bookingAppointment,
  );
  app.use((e, _req, res, _next) =>
    res.status(e.statusCode || 400).json({ message: e.message }),
  );
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
  if (oldAdminPhone === undefined) delete process.env.ADMIN_PHONE_NUMBER;
  else process.env.ADMIN_PHONE_NUMBER = oldAdminPhone;
});
async function fixture(mode = "MODE_B", country = "EGYPT", capacity = 20) {
  const suffix = randomUUID();
  const patient = await db.user.create({
    data: {
      phoneNumber: "patient-" + suffix,
      fullName: "Flow patient",
      role: "PATIENT",
      wallet: 1000,
      patient: { create: {} },
    },
    include: { patient: true },
  });
  const timezone = {
    LIBYA: "Africa/Tripoli",
    TUNISIA: "Africa/Tunis",
    EGYPT: "Africa/Cairo",
    ALGERIA: "Africa/Algiers",
  }[country];
  const owner = await db.user.create({
    data: {
      phoneNumber: "clinic-" + suffix,
      fullName: "Flow clinic",
      country,
      role: "CLINIC",
      wallet: 100,
      serviceFree: 2,
      clinic: {
        create: {
          clinicName: "Flow " + suffix,
          adminVerified: true,
          isVisible: true,
          collectionMode: mode,
          trial: false,
          timezone,
        },
      },
    },
    include: { clinic: true },
  });
  const staff = await db.user.create({
    data: {
      phoneNumber: "staff-" + suffix,
      role: "MANAGER",
      manager: { create: { clinicId: owner.clinic.id } },
    },
  });
  await db.doctorClinic.create({
    data: { doctorId: "phase1-doctor", clinicId: owner.clinic.id },
  });
  await db.patientServiceFee.upsert({
    where: { country },
    create: {
      country,
      amount: 75,
      modelBPercentage: 10,
      clinicFeePercentage: 5,
    },
    update: { amount: 75, modelBPercentage: 10, clinicFeePercentage: 5 },
  });
  const date = new Date(Date.now() + 86400000);
  date.setUTCHours(0, 0, 0, 0);
  const day = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ][date.getUTCDay()];
  const working = await db.workingDay.create({
    data: {
      doctorId: "phase1-doctor",
      clinicId: owner.clinic.id,
      day,
      slots: { create: { startTime: "12:00", endTime: "15:00", capacity } },
    },
    include: { slots: true },
  });
  const payload = {
    doctorId: "phase1-doctor",
    clinicId: owner.clinic.id,
    workingSlotId: working.slots[0].id,
    consultDate: date.toISOString().slice(0, 10),
  };
  return {
    patient,
    owner,
    staff,
    clinic: owner.clinic,
    date,
    payload,
    slot: working.slots[0],
  };
}
async function wallet(id) {
  return db.user.findUnique({
    where: { id },
    select: { wallet: true, frozenWallet: true },
  });
}
async function sum(f) {
  return Number(
    (
      (await wallet(f.patient.id)).wallet +
      (await wallet(f.owner.id)).wallet +
      (await wallet(admin.id)).wallet
    ).toFixed(2),
  );
}
async function withClock(now, fn) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}
function job(name, f, b) {
  return {
    name,
    data: {
      appointmentId: b.id,
      patientId: f.patient.patient.id,
      patientUserId: f.patient.id,
      clinicId: f.clinic.id,
      clinicUserId: f.owner.id,
      adminUserId: admin.id,
      patientServiceFee: b.serviceFeeAmount,
      clinicServiceFee: b.clinicServiceFee,
    },
  };
}
const runJob = (job) => workers.get("appointment-lifecycle")(job);

test("clinic calendar and advance-booking limit stay correct across UTC midnight", async () => {
  const f = await fixture("MODE_A", "EGYPT");
  const { getClinicCalendarDate } = require("../src/utils/timezoneHelper");
  const { PatientService } = require("../src/app/modules/Patient/patient.service");
  const now = Date.UTC(2030, 0, 1, 23, 30);
  for (const zone of ["Africa/Tripoli", "Africa/Tunis", "Africa/Cairo", "Africa/Algiers"]) {
    assert.equal(getClinicCalendarDate(new Date(now), zone).toISOString().slice(0, 10), "2030-01-02");
  }
  await withClock(now, async () => {
    const details = await PatientService.getDoctor("phase1-doctor", f.clinic.id);
    assert.equal(details.clinicLocalDate, "2030-01-02");
    const max = (await db.platformBookingSetting.findFirst())?.advanceBookingDays ?? 14;
    const last = getClinicCalendarDate(new Date(now), f.clinic.timezone); last.setUTCDate(last.getUTCDate() + max);
    const day = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][last.getUTCDay()];
    await db.workingDay.update({ where: { id: f.slot.workingDayId }, data: { day } });
    const b = await BookingService.createBooking(f.patient.id, { ...f.payload, consultDate: last });
    const outside = new Date(last); outside.setUTCDate(outside.getUTCDate() + 1);
    await assert.rejects(BookingService.createBooking(f.patient.id, { ...f.payload, consultDate: outside }), /Advance booking is limited/);
    await BookingService.cancelBooking(b.id, f.patient.id, "PATIENT", "Boundary test cleanup");
  });
});

for (const country of ["LIBYA", "TUNISIA", "EGYPT", "ALGERIA"])
  for (const mode of ["MODE_A", "MODE_B"])
    test(`${country} ${mode}: actual family request -> staff confirmation -> patient arrival -> complete reconciles all wallets`, async () => {
      const f = await fixture(mode, country),
        before = await sum(f);
      const b = await BookingService.createBooking(f.patient.id, {
        ...f.payload,
        bookedFor: "FAMILY",
        familyMemberName: "Synthetic dependent",
        familyMemberRelation: "CHILD",
      });
      assert.equal(b.status, "PENDING");
      assert.equal(b.feeCountry, country);
      assert.equal(b.collectionMode, mode);
      assert.equal(b.familyMemberName, "Synthetic dependent");
      assert.equal(b.serviceFeeAmount, mode === "MODE_A" ? 75 : 7.55);
      assert.equal(b.clinicServiceFee, 3.78);
      assert.equal((await wallet(f.patient.id)).wallet, 1000);
      assert.equal((await wallet(f.patient.id)).frozenWallet, b.holdAmount);
      assert.equal((await wallet(f.owner.id)).frozenWallet, 3.78);
      assert.ok(
        scheduled.some(
          (c) =>
            c.method === "schedulePendingBookingTimeout" &&
            c.args[0].appointmentId === b.id &&
            c.args[0].adminUserId === admin.id,
        ),
      );
      for (const actor of [
        { id: f.patient.id, role: "PATIENT" },
        { id: f.owner.id, role: "CLINIC" },
        { id: f.staff.id, role: "MANAGER" },
        { id: "phase1-doctor-user", role: "DOCTOR" },
      ])
        assert.ok(
          (
            await ops.list(actor, { clinicId: f.clinic.id, limit: 5000 })
          ).data.some((row) => row.id === b.id),
        );
      await BookingService.confirmBooking(b.id, f.staff.id, "MANAGER");
      assert.equal(
        (await wallet(f.patient.id)).wallet,
        Number((1000 - b.holdAmount).toFixed(2)),
      );
      assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
      assert.equal(
        Number((await wallet(f.owner.id)).wallet.toFixed(2)),
        mode === "MODE_B" ? 171.72 : 96.22,
      );
      assert.equal((await wallet(f.owner.id)).frozenWallet, 0);
      await assert.rejects(
        BookingService.confirmBooking(b.id, f.staff.id, "MANAGER"),
        /Cannot confirm/,
      );
      const start = getAppointmentStartUTC(
        f.date,
        b.startTime,
        f.clinic.timezone,
      ).getTime();
      await withClock(start - 3 * 3600000 - 1, () =>
        assert.rejects(
          BookingService.markPatientArrived(b.id, f.patient.id),
          /3 hours/,
        ),
      );
      await withClock(start - 3 * 3600000, async () => {
        await BookingService.markPatientArrived(b.id, f.patient.id);
        await ClinicService.updateAppointmentStatus(
          f.staff.id,
          b.id,
          "INPROGRESS",
          undefined,
          "MANAGER",
        );
        await BookingService.completeBooking(b.id, f.staff.id, "MANAGER");
      });
      assert.equal(
        (await db.bookingAppointment.findUnique({ where: { id: b.id } }))
          .status,
        "COMPLETE",
      );
      assert.equal(await sum(f), before);
      assert.equal(
        await db.adminTransaction.count({ where: { appointmentId: b.id } }),
        1,
      );
      const ledger = await history.wallet(
        { id: f.patient.id, role: "PATIENT" },
        { searchTerm: b.id },
      );
      assert.equal(ledger.data.length, 1);
      assert.equal(ledger.data[0].amount, b.holdAmount);
      assert.ok(
        await db.patientNotification.count({
          where: {
            bookingAppointmentId: b.id,
            notificationType: "APPOINTMENT_COMPLETED",
          },
        }),
      );
    });

test("patient HTTP request accepts date alias, rejects incomplete family details and cannot choose another patient", async () => {
  const f = await fixture();
  const call = (body) =>
    fetch(base + "/patient/appointment-booking", {
      method: "POST",
      headers: {
        Authorization: f.patient.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const { consultDate, ...rest } = f.payload;
  const bad = await call({ ...rest, date: consultDate, bookedFor: "FAMILY" });
  assert.equal(bad.status, 400);
  assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
  const response = await call({
    ...rest,
    date: consultDate,
    patientId: "phase1-patient",
    holdAmount: 0,
    serviceFeeAmount: 0,
  });
  assert.equal(response.status, 200);
  const { data: b } = await response.json();
  assert.equal(b.patientId, f.patient.patient.id);
  assert.equal(b.holdAmount, 83.05);
  await BookingService.cancelBooking(
    b.id,
    f.patient.id,
    "PATIENT",
    "Synthetic request cleanup",
  );
  assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
});

test("pending rejection and timeout release both holds exactly once without creating money", async () => {
  const f = await fixture(),
    before = await sum(f);
  const b = await BookingService.createBooking(f.patient.id, f.payload);
  await BookingService.rejectBooking(
    b.id,
    "Clinic unavailable",
    "MANAGER",
    f.staff.id,
  );
  assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
  assert.equal((await wallet(f.owner.id)).frozenWallet, 0);
  assert.equal(await sum(f), before);
  assert.equal((await runJob(job("PENDING_TIMEOUT", f, b))).status, "skipped");
  const pending = await BookingService.createBooking(f.patient.id, f.payload);
  const timeout = job("PENDING_TIMEOUT", f, pending);
  await runJob(timeout);
  const after = await sum(f);
  assert.equal(after, before);
  assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
  assert.equal((await wallet(f.owner.id)).frozenWallet, 0);
  const penaltyCount = await db.topUp.count({
    where: { appointmentId: pending.id, type: "PENALTY" },
  });
  assert.equal(penaltyCount, 2);
  assert.equal(
    (
      await history.wallet(
        { id: admin.id, role: "ADMIN" },
        { searchTerm: pending.id },
      )
    ).data.find((r) => r.type === "PENALTY").direction,
    "CREDIT",
  );
  assert.equal(
    (
      await history.wallet(
        { id: f.owner.id, role: "CLINIC" },
        { searchTerm: pending.id },
      )
    ).data.find((r) => r.type === "PENALTY").direction,
    "DEBIT",
  );
  assert.equal((await runJob(timeout)).status, "skipped");
  assert.equal(await sum(f), after);
  assert.equal(
    await db.topUp.count({
      where: { appointmentId: pending.id, type: "PENALTY" },
    }),
    penaltyCount,
  );
});

test("Model B automatic neglected settlement reclaims clinic credit and refunds patient once, including a cancellation race", async () => {
  const f = await fixture(),
    before = await sum(f);
  for (const race of [false, true]) {
    const b = await BookingService.createBooking(f.patient.id, f.payload);
    await BookingService.confirmBooking(b.id, f.owner.id, "CLINIC");
    const timeout = job("CONFIRMED_TIMEOUT", f, b);
    if (race) {
      await Promise.allSettled([
        runJob(timeout),
        BookingService.cancelBooking(
          b.id,
          f.owner.id,
          "CLINIC",
          "Race cancellation",
          "DOCTOR_ABSENT",
        ),
      ]);
    } else await runJob(timeout);
    const settled = await db.bookingAppointment.findUnique({
      where: { id: b.id },
    });
    assert.ok(["NOT_SHOW", "CANCELLED"].includes(settled.status));
    assert.equal(settled.refundPatient, true);
    assert.equal(await sum(f), before);
    assert.equal(
      await db.topUp.count({ where: { appointmentId: b.id, type: "REFUND" } }),
      2,
    );
    const debit = await db.topUp.findUnique({
        where: { id: `booking:${b.id}:refund:debit` },
      }),
      credit = await db.topUp.findUnique({
        where: { id: `booking:${b.id}:refund:credit` },
      });
    assert.equal(debit.userId, f.owner.id);
    assert.equal(credit.userId, f.patient.id);
    assert.equal(debit.amount, 75.5);
    assert.equal(credit.amount, 75.5);
    const p = await wallet(f.patient.id),
      c = await wallet(f.owner.id);
    await runJob(timeout);
    assert.deepEqual(await wallet(f.patient.id), p);
    assert.deepEqual(await wallet(f.owner.id), c);
  }
});

test("arrived timeout completes without refund or another charge, and late confirmation does not capture holds", async () => {
  const f = await fixture(),
    b = await BookingService.createBooking(f.patient.id, f.payload);
  await BookingService.confirmBooking(b.id, f.owner.id, "CLINIC");
  const p = await wallet(f.patient.id);
  const start = getAppointmentStartUTC(
    f.date,
    b.startTime,
    f.clinic.timezone,
  ).getTime();
  await withClock(start, () =>
    BookingService.markPatientArrived(b.id, f.patient.id),
  );
  await runJob(job("CONFIRMED_TIMEOUT", f, b));
  assert.equal(
    (await db.bookingAppointment.findUnique({ where: { id: b.id } })).status,
    "COMPLETE",
  );
  assert.deepEqual(await wallet(f.patient.id), p);
  const expired = await BookingService.createBooking(f.patient.id, f.payload);
  const held = await wallet(f.patient.id);
  await withClock(start, () =>
    assert.rejects(
      BookingService.confirmBooking(expired.id, f.owner.id, "CLINIC"),
      /deadline has passed/,
    ),
  );
  assert.deepEqual(await wallet(f.patient.id), held);
  await BookingService.rejectBooking(
    expired.id,
    "Expired request",
    "CLINIC",
    f.owner.id,
  );
});

test("patient cancellation cutoff and doctor absence preserve captured fees and refund only collected consultation", async () => {
  const f = await fixture(),
    before = await sum(f),
    b = await BookingService.createBooking(f.patient.id, f.payload);
  await BookingService.confirmBooking(b.id, f.owner.id, "CLINIC");
  const start = getAppointmentStartUTC(
      f.date,
      b.startTime,
      f.clinic.timezone,
    ).getTime(),
    p = await wallet(f.patient.id);
  await withClock(start - 11 * 3600000, () =>
    assert.rejects(
      BookingService.cancelBooking(b.id, f.patient.id, "PATIENT", "Too late"),
      /12 hours/,
    ),
  );
  assert.deepEqual(await wallet(f.patient.id), p);
  await withClock(start - 13 * 3600000, () =>
    BookingService.cancelBooking(
      b.id,
      f.patient.id,
      "PATIENT",
      "Patient cancellation",
    ),
  );
  assert.equal(Number((await wallet(f.patient.id)).wallet.toFixed(2)), 992.45);
  assert.equal(await sum(f), before);
  const after = await wallet(f.patient.id);
  await assert.rejects(
    BookingService.cancelBooking(
      b.id,
      f.owner.id,
      "CLINIC",
      "Repeat",
      "DOCTOR_ABSENT",
    ),
    /Cannot cancel/,
  );
  assert.deepEqual(await wallet(f.patient.id), after);
});

test("concurrent capacity requests preserve wallet holds and cancelled serial numbers are never reused", async () => {
  const f = await fixture("MODE_B", "EGYPT", 1);
  const results = await Promise.allSettled([
    BookingService.createBooking(f.patient.id, f.payload),
    BookingService.createBooking(f.patient.id, f.payload),
    BookingService.createBooking(f.patient.id, f.payload),
  ]);
  const booked = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  assert.equal(booked.length, 1);
  assert.equal((await wallet(f.patient.id)).frozenWallet, 83.05);
  assert.equal((await wallet(f.owner.id)).frozenWallet, 3.78);
  await BookingService.cancelBooking(
    booked[0].id,
    f.patient.id,
    "PATIENT",
    "Free period",
  );
  const next = await BookingService.createBooking(f.patient.id, f.payload);
  assert.ok(next.serialNumber > booked[0].serialNumber);
  await BookingService.cancelBooking(
    next.id,
    f.patient.id,
    "PATIENT",
    "Cleanup",
  );
  assert.equal((await wallet(f.patient.id)).frozenWallet, 0);
});

test("booking validation failures do not reserve funds or create a request", async () => {
  const f = await fixture(),
    p = await wallet(f.patient.id),
    c = await wallet(f.owner.id);
  for (const patch of [
    { workingSlotId: "outside-slot" },
    { consultDate: "invalid" },
    { consultDate: "2000-01-01" },
  ])
    await assert.rejects(
      BookingService.createBooking(f.patient.id, { ...f.payload, ...patch }),
    );
  await db.user.update({ where: { id: f.patient.id }, data: { wallet: 0 } });
  await assert.rejects(
    BookingService.createBooking(f.patient.id, f.payload),
    /Insufficient wallet/,
  );
  await db.user.update({
    where: { id: f.patient.id },
    data: { wallet: p.wallet },
  });
  await db.user.update({ where: { id: f.owner.id }, data: { wallet: 0 } });
  await assert.rejects(
    BookingService.createBooking(f.patient.id, f.payload),
    /Clinic wallet/,
  );
  await db.user.update({
    where: { id: f.owner.id },
    data: { wallet: c.wallet },
  });
  await db.clinic.update({
    where: { id: f.clinic.id },
    data: { adminVerified: false },
  });
  await assert.rejects(
    BookingService.createBooking(f.patient.id, f.payload),
    /not approved/,
  );
  assert.deepEqual(await wallet(f.patient.id), p);
  assert.deepEqual(await wallet(f.owner.id), c);
  assert.equal(
    await db.bookingAppointment.count({ where: { clinicId: f.clinic.id } }),
    0,
  );
});

test("Model A neglected timeout retains only captured fees and does not invent a consultation refund", async () => {
  const f = await fixture("MODE_A"),
    before = await sum(f),
    b = await BookingService.createBooking(f.patient.id, f.payload);
  await BookingService.confirmBooking(b.id, f.owner.id, "CLINIC");
  const p = await wallet(f.patient.id),
    c = await wallet(f.owner.id);
  await runJob(job("CONFIRMED_TIMEOUT", f, b));
  assert.deepEqual(await wallet(f.patient.id), p);
  assert.deepEqual(await wallet(f.owner.id), c);
  assert.equal(await sum(f), before);
  assert.equal(
    await db.topUp.count({ where: { appointmentId: b.id, type: "REFUND" } }),
    0,
  );
});

test("real scheduler uses clinic-local deadlines and restores arrived jobs after restart without guessing legacy times", async () => {
  const f = await fixture(),
    b = await BookingService.createBooking(f.patient.id, f.payload);
  await BookingService.confirmBooking(b.id, f.owner.id, "CLINIC");
  const start = getAppointmentStartUTC(
    f.date,
    b.startTime,
    f.clinic.timezone,
  ).getTime();
  await withClock(start, () =>
    BookingService.markPatientArrived(b.id, f.patient.id),
  );
  const unknown = await db.bookingAppointment.create({
    data: {
      patientId: f.patient.patient.id,
      clinicId: f.clinic.id,
      doctorId: "phase1-doctor",
      consultDate: f.date,
      serialNumber: 2,
      status: "ARRIVED",
    },
  });
  const entries = [],
    values = new Map(),
    jobs = new Map();
  const queue = {
    getJob: async (id) => jobs.get(id),
    add: async (name, data, options) => {
      const record = { name, data, options };
      entries.push(record);
      const job = {
        id: options.jobId,
        remove: async () => {
          jobs.delete(options.jobId);
        },
      };
      jobs.set(job.id, job);
      return job;
    },
  };
  const loader = Module._load;
  Module._load = function (request, parent, main) {
    if (request.endsWith("/shared/prisma"))
      return { __esModule: true, default: db };
    if (request.endsWith("/queues/bookingQueue"))
      return {
        bookingNotificationQueue: queue,
        appointmentLifecycleQueue: queue,
      };
    if (request.endsWith("/redisServer"))
      return {
        redis: {
          get: async (key) => values.get(key),
          set: async (key, value) => values.set(key, value),
          del: async (key) => values.delete(key),
        },
      };
    return loader.call(this, request, parent, main);
  };
  let scheduler;
  try {
    scheduler =
      require("../src/app/jobs/services/bookingScheduler.service").BookingSchedulerService;
  } finally {
    Module._load = loader;
  }
  await scheduler.repairActiveLifecycleJobs();
  const restored = entries.find(
    (e) => e.name === "CONFIRMED_TIMEOUT" && e.data.appointmentId === b.id,
  );
  assert.ok(restored);
  const expected =
    getAppointmentStartUTC(f.date, b.endTime, f.clinic.timezone).getTime() +
    12 * 3600000 -
    Date.now();
  assert.ok(Math.abs(restored.options.delay - expected) < 1500);
  assert.equal(restored.options.jobId.includes(":"), false);
  assert.equal(
    entries.some((e) => e.data.appointmentId === unknown.id),
    false,
  );
  assert.equal(
    (await db.bookingAppointment.findUnique({ where: { id: unknown.id } }))
      .status,
    "ARRIVED",
  );
  await BookingService.completeBooking(b.id, f.owner.id, "CLINIC");
  await db.bookingAppointment.update({
    where: { id: unknown.id },
    data: { status: "NOT_SHOW" },
  });
});


test("reconciliation separates saved countries, unknown history and doctor/clinic totals", async () => {
  const f = await fixture("MODE_A", "EGYPT");
  const b = await BookingService.createBooking(f.patient.id, f.payload);
  await db.bookingAppointment.update({ where:{id:b.id}, data:{status:"COMPLETE", feeCountry:"EGYPT", consultFee:100, clinicServiceFee:5} });
  const clone = await db.bookingAppointment.findUnique({where:{id:b.id}});
  for (const [country, fee] of [["TUNISIA",200],[null,300]]) {
    await db.bookingAppointment.create({data:{...clone,id:randomUUID(),serialNumber:clone.serialNumber + fee,feeCountry:country,consultFee:fee}});
  }
  const balanceBeforeReads = await wallet(f.owner.id);
  const result = await ClinicService.getClinicReconciliationReports(f.owner.id, {}, {limit:100});
  assert.equal(result.summary.totalConsultFees,null);
  assert.equal(result.summary.currency,null);
  assert.deepEqual(result.summary.byCountry.map(g=>[g.country,g.currency,g.totalConsultFees]).sort(),[["EGYPT","EGP",100],["HISTORICAL_UNSPECIFIED","Unspecified",300],["TUNISIA","TND",200]].sort());
  assert.equal(result.doctorBreakdown.length,3); assert.equal(result.clinicBreakdown.length,3);
  const financial = await ClinicService.getClinicFinancialSummary(f.owner.id);
  assert.equal(financial.walletCurrency,"EGP"); assert.equal(financial.totalEarnings,100);
  assert.equal(financial.consultationTotalsByCountry.length,3);
  assert.deepEqual(await wallet(f.owner.id),balanceBeforeReads);
  require('node:fs').writeFileSync('tmp/mismatch-finance-fixture.json',JSON.stringify({ownerId:f.owner.id,clinicId:f.clinic.id}));
});

test("legacy and managed status filters separate manual no-show, automatic unresolved and doctor absence", async () => {
  const f=await fixture(); const b=await BookingService.createBooking(f.patient.id,f.payload);
  const actor={id:f.owner.id,role:"CLINIC"};
  for(const [patch, expected] of [
    [{status:"NOT_SHOW",absenceType:null,noShowReason:null,cancellationReason:null},"PATIENT_NO_SHOW"],
    [{status:"NOT_SHOW",absenceType:null,noShowReason:"Auto-settled: Neglected (no arrival recorded). Old worker",cancellationReason:null},"AUTO_UNRESOLVED"],
    [{status:"NOT_SHOW",absenceType:"AUTO_UNRESOLVED",noShowReason:null,cancellationReason:null},"AUTO_UNRESOLVED"],
    [{status:"CANCELLED",absenceType:"DOCTOR_ABSENT",noShowReason:null,cancellationReason:"Doctor absent"},"DOCTOR_ABSENT"],
  ]) {
    await db.bookingAppointment.update({where:{id:b.id},data:patch});
    const managed=await ops.list(actor,{status:expected});
    assert.equal(managed.data[0]?.displayStatus,expected);
    const legacy=await BookingService.getBookings(actor.id,actor.role,{status:expected,limit:25});
    assert.equal(legacy.data[0]?.displayStatus,expected);
    const managerHistory=await ClinicService.getManagerBookingHistory(actor.id,{status:expected},{limit:25});
    const ownerHistory=await ClinicService.getBookingHistory(actor.id,{status:expected},{limit:25});
    assert.equal(managerHistory.data[0]?.displayStatus,expected);
    assert.equal(ownerHistory.data[0]?.displayStatus,expected);
    const other=await ops.list(actor,{status:expected==="PATIENT_NO_SHOW"?"AUTO_UNRESOLVED":"PATIENT_NO_SHOW"});
    assert.equal(other.data.length,0);
  }
  await db.bookingAppointment.update({where:{id:b.id},data:{bookedFor:'FAMILY',familyMemberName:'Browser Family Attendee',familyMemberRelation:'Sister'}});
  require('node:fs').writeFileSync('tmp/mismatch-status-fixture.json',JSON.stringify({ownerId:f.owner.id,bookingId:b.id}));
});

test("overview uses each clinic calendar across midnight, including doctor working at multiple clinics", async()=>{
  const east=await fixture(),west=await fixture();
  await db.clinic.update({where:{id:west.clinic.id},data:{timezone:"America/New_York"}});
  const a=await BookingService.createBooking(east.patient.id,east.payload),b=await BookingService.createBooking(west.patient.id,west.payload);
  await db.bookingAppointment.update({where:{id:a.id},data:{consultDate:new Date("2030-01-02T00:00:00Z")}});
  await db.bookingAppointment.update({where:{id:b.id},data:{consultDate:new Date("2030-01-01T00:00:00Z")}});
  await withClock(Date.parse("2030-01-01T23:30:00Z"),async()=>{
    const view=await history.overview({id:"phase1-doctor-user",role:"DOCTOR"});
    assert.equal(view.todayCount,2);
    assert.equal(view.clinicLocalDates.find(c=>c.clinicId===east.clinic.id).date,"2030-01-02");
    assert.equal(view.clinicLocalDates.find(c=>c.clinicId===west.clinic.id).date,"2030-01-01");
    assert.ok(view.upcoming.some(row=>row.id===a.id)); assert.ok(view.upcoming.some(row=>row.id===b.id));
  });
});
