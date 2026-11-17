export const MIN_PASSWORD_LENGTH: number;
export function passwordFeedback(password: string, identity?: { email?: string; firstName?: string; lastName?: string }): string | null;
export function passwordStrength(password: string, identity?: { email?: string; firstName?: string; lastName?: string }): { label: string; score: number };
