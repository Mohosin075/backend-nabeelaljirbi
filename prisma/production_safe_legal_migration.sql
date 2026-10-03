-- ============================================================================
-- Production-Safe Migration: Legal Agreements & User Acceptance Tracking
-- Zero-Data-Loss: Only adds new tables and indexes. Never modifies existing data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "legal_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" "UserRole" NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "content" TEXT NOT NULL,
    "contentAr" TEXT,
    "version" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requireReacceptance" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "legal_documents_role_isActive_idx" ON "legal_documents"("role", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "legal_documents_role_version_key" ON "legal_documents"("role", "version");

CREATE TABLE IF NOT EXISTS "user_agreement_acceptances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "user_agreement_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_agreement_acceptances_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_agreement_acceptances_userId_role_idx" ON "user_agreement_acceptances"("userId", "role");
CREATE INDEX IF NOT EXISTS "user_agreement_acceptances_documentId_idx" ON "user_agreement_acceptances"("documentId");
CREATE UNIQUE INDEX IF NOT EXISTS "user_agreement_acceptances_userId_documentId_documentVersion_key" ON "user_agreement_acceptances"("userId", "documentId", "documentVersion");

-- ============================================================================
-- Initial v1.0 Legal Documents Database Seeding
-- Production-Safe: ON CONFLICT ("role", "version") DO NOTHING
-- ============================================================================
INSERT INTO "legal_documents" ("id", "role", "title", "titleAr", "content", "contentAr", "version", "effectiveDate", "requireReacceptance", "isActive", "createdAt", "updatedAt")
VALUES
(
    'legal_patient_v1_0',
    'PATIENT',
    'Patient Terms of Service & Privacy Policy',
    'شروط خدمة وسياسة خصوصية المريض',
    'Welcome to Salama. By creating an account or using our platform as a patient, you agree to:
1. Provide accurate and complete personal health and contact information.
2. Attend scheduled clinic appointments on time or cancel them in advance according to the clinic''s policy.
3. Understand that Salama provides booking and healthcare facilitation services and does not replace emergency medical interventions.
4. Agree that consultation fees and service fees are held and processed according to the stated clinic booking rules.
5. Respect data privacy and use the platform solely for lawful healthcare purposes.',
    'مرحبًا بك في سلامة. بإنشاء حساب أو استخدام منصتنا كمريض، فإنك توافق على:
1. تقديم معلومات صحية وشخصية دقيقة وكاملة.
2. الحضور في المواعيد المحددة للعيادة أو إلغائها مسبقًا وفقًا لسياسة العيادة.
3. تفهم أن سلامة توفر خدمات حجز وتسهيل الرعاية الصحية ولا تحل محل التدخلات الطبية الطارئة.
4. الموافقة على أن رسوم الاستشارة ورسوم الخدمة يتم حجزها ومعالجتها وفقًا لقواعد حجز العيادة المحددة.
5. احترام خصوصية البيانات واستخدام المنصة للأغراض الصحية المشروعة فقط.',
    '1.0',
    CURRENT_TIMESTAMP,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'legal_doctor_v1_0',
    'DOCTOR',
    'Doctor Terms of Service & Professional Agreement',
    'شروط خدمة واتفاقية الممارسة المهنية للأطباء',
    'As a registered and verified medical professional on Salama, you agree to:
1. Maintain valid medical licensure, credentials, and certifications.
2. Provide diligent, ethical, and evidence-based healthcare consultations.
3. Keep your clinical working schedule, slots, and availability accurate.
4. Maintain strict patient-physician confidentiality and medical records privacy.
5. Comply with agreed platform consultation fee structures and payout policies.',
    'بصفتك ممارسًا طبيًا مسجلاً ومتحققًا منه في سلامة، فإنك توافق على:
1. الحفاظ على التراخيص والشهادات والاعتمادات الطبية السارية.
2. تقديم استشارات رعاية صحية باجتهاد وأخلاقية وقائمة على الأدلة.
3. الحفاظ على دقة جدول عملك السريري ومواعيدك وتواجدك.
4. الحفاظ على السرية التامة بين الطبيب والمريض وخصوصية السجلات الطبية.
5. الامتثال لهياكل رسوم الاستشارة المتفق عليها وسياسات الصرف للمنصة.',
    '1.0',
    CURRENT_TIMESTAMP,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'legal_clinic_v1_0',
    'CLINIC',
    'Clinic Terms of Service & Operations Agreement',
    'شروط خدمة واتفاقية تشغيل العيادات والمراكز الطبية',
    'As an affiliated clinic or medical center on Salama, you agree to:
1. Hold valid institutional health permits, licenses, and official operating approvals.
2. Ensure doctors associated with your center are duly qualified and verified.
3. Manage appointment statuses (Pending, Confirmed, Arrived, In Progress, Completed, No-Show) accurately and in real-time.
4. Respect patient bookings and manage financial settlements with affiliated doctors responsibly.
5. Honor platform booking policies, refunds, and service fees as configured.',
    'بصفتك عيادة أو مركزًا طبيًا مسجلاً في سلامة، فإنك توافق على:
1. امتلاك تصاريح وتراخيص صحية مؤسسية سارية وموافقات تشغيل رسمية.
2. التأكد من أن الأطباء التابعين لمركزك مؤهلون ومعتمدون حسب الأصول.
3. إدارة حالات المواعيد (معلق، مؤكد، وصل، قيد المعاينة، مكتمل، لم يحضر) بدقة وفي الوقت الفعلي.
4. احترام حجوزات المرضى وإدارة التسويات المالية مع الأطباء التابعين بمسؤولية.
5. الالتزام بسياسات الحجز والاسترداد ورسوم الخدمة المحددة للمنصة.',
    '1.0',
    CURRENT_TIMESTAMP,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("role", "version") DO NOTHING;
