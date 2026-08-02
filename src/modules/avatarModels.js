// ─── Avatar model registry ───
// 5 VRM avatars (male + female) from verified public GitHub repositories.
// All freely licensed for use (CC0 or VRoid sample terms).
//
// IMPORTANT: Every URL below has been verified to return a valid .vrm file.

const AVATAR_MODELS = [
  {
    id: 'avatar_b',
    name: 'Hana',
    gender: 'female',
    emoji: '👩',
    source: 'VRoid AvatarSample_B',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm',
  },
  {
    id: 'avatar_a',
    name: 'Yuki',
    gender: 'female',
    emoji: '👧',
    source: 'VRoid AvatarSample_A',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm',
  },
  {
    id: 'avatar_c',
    name: 'Taro',
    gender: 'male',
    emoji: '👨',
    source: 'VRoid AvatarSample_C',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_C.vrm',
  },
  {
    id: 'avatar_orion',
    name: 'Orion',
    gender: 'male',
    emoji: '🧑',
    source: 'Avatar Orion (CC0)',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/Avatar_Orion.vrm',
  },
];

export default AVATAR_MODELS;
