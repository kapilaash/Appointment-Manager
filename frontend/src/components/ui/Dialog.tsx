import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';

type DialogProps = {
  open: boolean;
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
};

export function Dialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Go back',
  busy = false,
  confirmDisabled = false,
  destructive = false,
  onClose,
  onConfirm,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per dialog so two dialogs on one page never share label ids.
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="m-auto w-[min(92vw,34rem)] rounded-2xl border-0 bg-transparent p-0 shadow-2xl backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      <section className="dialog-enter rounded-2xl border border-neutral-200 bg-surface p-4 sm:p-6">
        <h2 id={titleId} className="text-lg font-semibold text-heading">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-neutral-600">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" className="w-full sm:w-auto" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            variant={destructive ? 'danger' : 'primary'}
          >
            {busy ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </section>
    </dialog>
  );
}
