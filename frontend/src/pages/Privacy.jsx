import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '@/layouts/auth-layout'
import { Card, CardContent } from '@/components/ui/card'

// Public privacy policy. Google Play needs a privacy-policy URL reachable without
// signing in, so this route sits outside every guard (like forgot/reset password).
// It must stay in step with the Play Console Data safety answers: camera,
// location, and account data (zoiko-meds-app/PLAY_RELEASE.md).

const CONTACT = 'privacy@zoikomeds.com'
const LAST_UPDATED = '5 October 2026'

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function ContactLink() {
  return (
    <a href={`mailto:${CONTACT}`} className="font-medium text-teal underline underline-offset-2">
      {CONTACT}
    </a>
  )
}

export default function Privacy() {
  return (
    <AuthLayout
      title="Privacy policy"
      description="What ZoikoMeds collects in the Android app and on the web, why, and how to have it deleted."
      pills={[{ icon: <ShieldCheck className="size-3.5 text-teal" />, label: 'Applies to the app and the website' }]}
    >
      <Card className="border border-border/70 bg-card shadow-xl backdrop-blur-md">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4">
            <Section title="What ZoikoMeds is">
              <p>
                ZoikoMeds shows where medicines may be available near you, based on availability signals shared by
                verified pharmacies. It is not a pharmacy, does not sell or dispense medicines, and gives no medical
                advice.
              </p>
            </Section>

            <Section title="Account information">
              <p>
                Creating an account stores your email address and name. Pharmacy accounts also store the pharmacy's
                name, licence number, phone number and address, because patients are shown which verified pharmacy
                reported a signal.
              </p>
              <p>This is used to run your account and to show pharmacy details to patients.</p>
            </Section>

            <Section title="Location">
              <p>
                "Use my location" sends your approximate or precise location with a nearby-pharmacy search so the
                results can be ordered by distance. Location is optional: you can type a place instead. The app does
                not collect location in the background and does not store a location history.
              </p>
            </Section>

            <Section title="Camera and prescription photos">
              <p>
                If you photograph a prescription, the app uses the camera for that one action. The photo is read on
                your device to find medicine names and is not uploaded. If server-side reading is enabled in a future
                version, the photo is sent only for that reading and this policy will say so before it happens.
              </p>
            </Section>

            <Section title="Medicines you search, save and follow">
              <p>
                Searches, saved medicines and alerts are stored against your account so the app can tell you when
                availability changes. They describe medicines, not your health conditions, and are not used for
                advertising.
              </p>
            </Section>

            <Section title="What is not collected">
              <ul className="list-disc pl-5">
                <li>No advertising identifiers and no third-party ad SDKs.</li>
                <li>
                  No payment card details — pharmacy subscription billing opens in your browser and is handled by the
                  payment provider.
                </li>
                <li>No location in the background.</li>
              </ul>
            </Section>

            <Section title="Sharing">
              <p>
                Account data is not sold and is not shared with advertisers. It is processed by the infrastructure
                providers that host the service.
              </p>
            </Section>

            <Section title="Transit and storage">
              <p>
                All traffic to the service is over HTTPS. Your session is held on your own device and is excluded from
                Android's cloud backup.
              </p>
            </Section>

            <Section title="Deleting your account and your data">
              <p>
                You can ask for your account and the personal data in it to be deleted at any time, and we action the
                request within 30 days. Send the request from the account's own email address to <ContactLink />, and
                say whether you are a patient account or a pharmacy account.
              </p>
              <p>
                Account, name, email, phone, saved medicines, alerts and search history are deleted. Two things are
                kept: pharmacy licence and verification records, which we are required to retain while a pharmacy is
                operating, and the audit records our governance policy requires us to hold. Neither includes your
                personal details.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions about this policy, or about a specific request: <ContactLink />.
              </p>
              <p className="text-xs">Last updated: {LAST_UPDATED}.</p>
            </Section>
          </div>

          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-teal hover:underline">
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
