import { api } from '../../app/store/api';
import type { Student } from '../appointments/api';

export const studentApi = api.injectEndpoints({
  endpoints: (build) => ({
    students: build.query<Student[], void>({ query: () => '/students', providesTags: ['Student'] }),
    deleteStudent: build.mutation<{ status: 'deleted' }, string>({
      query: (id) => ({ url: `/students/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Student', 'Appointment'],
    }),
  }),
});

export const { useStudentsQuery, useDeleteStudentMutation } = studentApi;
