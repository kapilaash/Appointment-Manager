import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { cn } from '../../lib/cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  label: string;
  hint?: string;
  withIcon?: boolean;
};

/**
 * A password input with a Show/Hide toggle. Pasting stays allowed so password managers work.
 * The toggle's name ("Show"/"Hide") deliberately avoids the word "password" so the field's
 * label stays unique for screen readers.
 */
export function PasswordField({ label, hint, withIcon = false, className, ...props }: Props) {
  const id = useId();
  const hintId = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold text-neutral-800">
        {label}
      </label>
      <div className="relative mt-2">
        {withIcon && (
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
          />
        )}
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            'block min-h-12 w-full rounded-xl border border-neutral-300 bg-surface py-3 pr-20 text-base text-heading shadow-sm transition focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/15',
            withIcon ? 'pl-11' : 'pl-3.5',
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-controls={id}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 flex min-h-9 min-w-0 -translate-y-1/2 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        >
          {visible ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export const PASSWORD_HINT =
  'At least 12 characters. A short phrase of a few unrelated words is strong and easy to remember.';
