export interface CreateBookingPayload {
  clinicId: string;
  doctorId: string;
  workingSlotId: string;
  consultDate: string | Date;
  bookedFor?: 'SELF' | 'FAMILY';
  familyMemberName?: string;
  familyMemberRelation?: string;
}

export interface BookingInterface extends CreateBookingPayload {}

export interface ApproveBookingPayload {
  note?: string;
}

export interface RejectBookingPayload {
  reason?: string;
}