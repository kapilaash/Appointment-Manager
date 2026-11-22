import { ArrowRight, CalendarDays, Clock3, Mail, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { useMeQuery } from '../auth/api';

type GuideStep = { title: string; description: string; to: string; action: string };

const adminSteps: GuideStep[] = [
  { title: 'Invite your coaching team', description: 'Create a coach invitation using the email address they will use to sign in. The one-time link expires after 48 hours.', to: '/coaches', action: 'Manage coach accounts' },
  { title: 'Keep availability current', description: 'Coaches set weekly hours in their own time zone. Date-specific exceptions handle holidays and one-off schedule changes. Changes you make here apply immediately.', to: '/availability', action: 'Review availability' },
  { title: 'Approve coach requests', description: 'When a coach changes their hours, time off, extra hours, or time zone, or asks to cancel or reschedule a demo, nothing changes until you approve it. Every admin is emailed; the coach is emailed your decision.', to: '/requests', action: 'Open approvals' },
  { title: 'Book a demo class', description: 'Choose an available coach and time, then add the student or parent contact email for updates.', to: '/book', action: 'Create a booking' },
  { title: 'Track changes and messages', description: 'Use the calendar for upcoming sessions. Appointment details show cancellation, reschedule, and email delivery history.', to: '/appointments', action: 'Open appointments' },
];

const coachSteps: GuideStep[] = [
  { title: 'Complete your profile', description: 'Set the country and IANA time zone where you coach. Availability and appointment times follow this region’s daylight-saving rules.', to: '/profile', action: 'Edit your profile' },
  { title: 'Set your teaching hours', description: 'Propose weekly hours, time off, or extra hours. An administrator approves each change before families can book it, and you are emailed the decision.', to: '/availability', action: 'Manage availability' },
  { title: 'Need to move or cancel a demo?', description: 'Open the demo and choose Request reschedule or Request cancellation. The booking stays as it is until an administrator approves, and the family is only told after approval.', to: '/my-requests', action: 'See my requests' },
  { title: 'Review your classes', description: 'Open the calendar or appointments list to check student details, meeting links, and updates. You can mark an ended demo as completed.', to: '/calendar', action: 'View your calendar' },
  { title: 'Choose a comfortable workspace', description: 'Change the appearance theme at any time. Your choice is saved in this browser for your account.', to: '/settings', action: 'Open settings' },
];

function GuideCard({ step, index }: { step: GuideStep; index: number }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <h4 className="font-medium text-slate-900">{step.title}</h4>
        <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
        <Link to={step.to} className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          {step.action}<ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function HelpPage() {
  const { data: user } = useMeQuery();
  const isAdmin = user?.role === 'admin';
  const steps = isAdmin ? adminSteps : coachSteps;
  const GuideIcon = isAdmin ? Users : CalendarDays;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-sm font-medium text-indigo-700">Help center</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-heading">A clear path through your workspace</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Quick guides for the everyday tasks in Thirumal Chess Academy. Your guide is tailored to your {isAdmin ? 'administrator' : 'coach'} role.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><GuideIcon size={19} aria-hidden="true" /></span>
            <div><h3 className="font-semibold text-slate-900">{isAdmin ? 'Administrator guide' : 'Coach guide'}</h3><p className="mt-0.5 text-sm text-slate-500">Four steps to keep the academy running smoothly</p></div>
          </div>
          <ol className="mt-6 space-y-5">{steps.map((step, index) => <GuideCard key={step.title} step={step} index={index} />)}</ol>
        </Card>

        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Clock3 size={19} aria-hidden="true" /></span><h3 className="font-semibold text-slate-900">Time zone tips</h3></div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <li>Availability is stored in the coach’s selected IANA region, including daylight-saving changes.</li>
              <li>Booking times are shown in the coach’s time zone. Check that region before confirming a class.</li>
              <li>Use a date-specific exception for a single holiday instead of changing the weekly schedule.</li>
            </ul>
          </Card>
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Mail size={19} aria-hidden="true" /></span><h3 className="font-semibold text-slate-900">Email and delivery</h3></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Local development mail appears in Mailpit. Live messages are sent through the production mail account. Appointment details include a delivery status and attempt count.</p>
            {isAdmin && <Link to="/settings" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline">Notification setup<ArrowRight size={15} aria-hidden="true" /></Link>}
          </Card>
        </div>
      </div>

      <Card className="border-indigo-200 bg-indigo-50/60 p-5 sm:p-6">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-indigo-700" size={20} aria-hidden="true" />
          <div><h3 className="font-semibold text-slate-900">Protect family information</h3><p className="mt-1 text-sm leading-6 text-slate-700">Use the booking contact address for a parent or guardian when appropriate. Keep instructor notes limited to details needed for the class, and avoid putting sensitive information in email or meeting links.</p><p className="mt-2 text-sm text-slate-600">For account access, invitations, or a reset link, contact the academy administrator.</p></div>
        </div>
      </Card>
    </div>
  );
}
