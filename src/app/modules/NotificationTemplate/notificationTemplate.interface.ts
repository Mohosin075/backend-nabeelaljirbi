export interface ICreateNotificationTemplate {
  eventKey: string;
  name: string;
  description?: string;
  titleEn: string;
  bodyEn: string;
  titleAr: string;
  bodyAr: string;
  pushEnabled?: boolean;
  inAppEnabled?: boolean;
  whatsappEnabled?: boolean;
  smsEnabled?: boolean;
  variables?: string[];
  isActive?: boolean;
}

export interface IUpdateNotificationTemplate {
  name?: string;
  description?: string;
  titleEn?: string;
  bodyEn?: string;
  titleAr?: string;
  bodyAr?: string;
  pushEnabled?: boolean;
  inAppEnabled?: boolean;
  whatsappEnabled?: boolean;
  smsEnabled?: boolean;
  variables?: string[];
  isActive?: boolean;
}
