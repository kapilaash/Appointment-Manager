import { useState } from 'react';
import { Trash2, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import type { Student } from '../appointments/api';
import { useDeleteStudentMutation, useStudentsQuery } from './api';

export function StudentsPage() {
  const query = useStudentsQuery();
  const [deleteStudent, result] = useDeleteStudentMutation();
  const [selected, setSelected] = useState<Student | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function confirmDelete() {
    if (!selected) return;
    setError('');
    try {
      await deleteStudent(selected.id).unwrap();
      setNotice('Student record deleted. Past bookings remain without student details.');
      setSelected(null);
    } catch {
      setError('This student has an active or future demo. Cancel or reschedule it before deleting their data.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">Students and families</h2>
        <p className="mt-1 text-sm text-slate-500">Contact details used for demo class coordination.</p>
      </div>
      <p className="rounded-lg border border-slate-200 bg-surface p-4 text-sm leading-6 text-slate-600">
        Deleting a student removes their contact details. Past bookings stay in the academy record with identifying
        information removed; students with active or future demos must be handled first.
      </p>
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          Could not load student records.
        </p>
      )}
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : query.data?.length ? (
          <div className="divide-y divide-slate-100">
            {query.data.map((student) => (
              <article
                key={student.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                    <Users size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{student.name}</p>
                    <p className="break-all text-sm text-slate-500">
                      {student.parent_name ? `${student.parent_name} · ` : ''}
                      {student.email}
                      {student.phone ? ` · ${student.phone}` : ''}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-slate-400">{student.timezone}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="text-xs text-rose-700"
                  disabled={result.isLoading}
                  onClick={() => {
                    setSelected(student);
                    setError('');
                  }}
                >
                  <Trash2 size={15} />
                  Delete student
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <Users className="mx-auto text-slate-400" />
            <p className="mt-3 font-medium">No student records yet</p>
            <p className="mt-1 text-sm text-slate-500">Student records are created when a demo is booked.</p>
          </div>
        )}
      </Card>
      <Dialog
        open={Boolean(selected)}
        title="Delete this student?"
        description={
          selected
            ? `Permanently delete ${selected.name}'s student record and contact details? Past bookings will remain in the academy record with student details removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete student data"
        destructive
        busy={result.isLoading}
        onClose={() => setSelected(null)}
        onConfirm={() => void confirmDelete()}
      >
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}
