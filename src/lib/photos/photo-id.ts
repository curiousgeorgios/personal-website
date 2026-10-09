/** The one shape of a photograph's id (fixture-b-01): gallery routes, download tokens and the print basket all check it */
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}-\d{2,3}$/;

export const isPhotoId = (value: string): boolean => PHOTO_ID.test(value);
