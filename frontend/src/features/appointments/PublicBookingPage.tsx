import { Crown } from 'lucide-react';
import { BookingPage } from './BookingPage';

export function PublicBookingPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-on-accent">
            <Crown size={20} />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-[.14em] text-neutral-500">Thirumal Chess Academy</p>
            <h1 className="text-lg font-semibold text-heading">Book a demo class</h1>
          </div>
        </header>
        <BookingPage publicMode />
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-neutral-500">
          Your contact details are used to arrange this demo and send booking updates. Academy workspace pages remain
          access controlled.
        </p>
      </div>
    </main>
  );
}
