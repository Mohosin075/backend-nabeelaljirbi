export type TSocialUser = {
  phoneNumber: string;
  name: string;
  provider: string;
};

export type TUser = {
  fullName?: string;
  phoneNumber: string;

  // update
  dateOfBirth?: Date;
  address?: string;
};
