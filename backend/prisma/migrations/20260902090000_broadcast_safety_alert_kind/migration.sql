-- Say which safety category an emergency broadcast belongs to, instead of
-- guessing it from the title.
--
-- ZoikoSignal split a dispatched EMERGENCY_ALERT into the patient's two safety
-- categories with `/recall/i.test(title)`: the word "recall" in the title meant
-- Medicine Recall, and everything else fell through to Government Safety. So
-- "Urgent product withdrawal" was filed as a government advisory, and which of
-- a patient's two toggles governed a broadcast depended on how an administrator
-- happened to word its heading.
--
-- Nullable on purpose. Every broadcast filed before this column existed keeps a
-- NULL and keeps being read by the title fallback; nothing historical is
-- rewritten. Non-emergency broadcasts stay NULL because the category does not
-- apply to them at all.
CREATE TYPE "SafetyAlertKind" AS ENUM ('MEDICINE_RECALL', 'GOVERNMENT_SAFETY');

ALTER TABLE "Notification" ADD COLUMN "safetyKind" "SafetyAlertKind";
