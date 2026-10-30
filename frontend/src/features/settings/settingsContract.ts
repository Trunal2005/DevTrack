import type { UpdateSettingsPayload, UserSettingsResponse } from '../../services/settingsService';

// Only these rendered fields have a server write contract today.
export const PLATFORM_FIELDS = {
  'platforms.github.username': ['github', 'username'],
  'platforms.codeforces.handle': ['codeforces', 'handle'],
  'platforms.leetcode.username': ['leetcode', 'username'],
  'platforms.codechef.username': ['codechef', 'username'],
} as const;
export type PlatformSettingId = keyof typeof PLATFORM_FIELDS;
export type PlatformValues = Record<PlatformSettingId, string>;
export const platformIds = Object.keys(PLATFORM_FIELDS) as PlatformSettingId[];
export const isPlatformSetting = (id: string): id is PlatformSettingId => Object.hasOwn(PLATFORM_FIELDS, id);
export const isEditableSetting = (id: string) => isPlatformSetting(id) || id === 'appearance.theme';

export function platformValues(settings: UserSettingsResponse | null): PlatformValues {
  return Object.fromEntries(platformIds.map(id => {
    const [platform, field] = PLATFORM_FIELDS[id];
    return [id, settings?.platforms[platform]?.[field] ?? ''];
  })) as PlatformValues;
}
export const hasPlatformChanges = (values: PlatformValues, saved: PlatformValues) => platformIds.some(id => values[id] !== saved[id]);

export function platformPayload(values: PlatformValues, saved: PlatformValues): UpdateSettingsPayload {
  const platforms: NonNullable<UpdateSettingsPayload['platforms']> = {};
  for (const id of platformIds) {
    if (values[id] === saved[id]) continue;
    const [platform, field] = PLATFORM_FIELDS[id];
    platforms[platform] = { ...platforms[platform], [field]: values[id] };
  }
  return { platforms };
}
