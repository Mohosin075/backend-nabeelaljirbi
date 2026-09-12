export type IUpdateUserProfile = {
  fullName?: string;
  gender?: "MALE" | "FEMALE";
  dateOfBirth?: string;
  country?: string;
  city?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
};
