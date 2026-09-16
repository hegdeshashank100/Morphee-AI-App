/**
 * avatarRegistry.js — Scalable Avatar Metadata Registry & Query Engine.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Maintains lightweight metadata for 100+ avatar definitions without instantiating
 * or loading VRM 3D meshes into GPU memory. Supports instant search, presentation filtering,
 * category filtering, tag queries, favorites, and usage tracking.
 *
 * SEPARATION OF CONCERNS:
 * Avatar Definition (Metadata) != Loaded Avatar Resource != AvatarInstance in GPU VRAM.
 */

export const AVATAR_CATEGORIES = ['all', 'anime', 'stylized', 'robot', 'community'];

/**
 * Verified base avatars present and verified in the Morphee AI project.
 * All URLs are verified public CC0, VRoid sample, or VRM Consortium models.
 * Contains 8 locally bundled offline avatars and 10 verified remote avatars.
 */
export const INITIAL_AVATAR_DEFINITIONS = [
  // ─── 1. BUNDLED OFFLINE AVATARS (>= 8 MODELS IN public/avatars/) ───
  {
    id: 'avatar_b',
    name: 'Hana',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'student', 'sample', 'core', 'bundled'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_b.webp',
    url: '/avatars/AvatarSample_B.vrm',
    localUrl: '/avatars/AvatarSample_B.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm',
    source: 'VRoid Studio Sample Model',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. VRoid Studio Sample Character B',
    verified: true,
    bundled: true,
    loadingPriority: 'high',
    cachePriority: 'high',
    description: 'Standard VRoid anime female student avatar with expressive ARKit-compatible shape keys.'
  },
  {
    id: 'avatar_a',
    name: 'Yuki',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'casual', 'core', 'bundled'],
    emoji: '👧',
    thumbnail: '/avatar-previews/avatar_a.webp',
    url: '/avatars/AvatarSample_A.vrm',
    localUrl: '/avatars/AvatarSample_A.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm',
    source: 'VRoid Studio Sample Model',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. VRoid Studio Sample Character A',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'VRoid anime girl character in casual attire.'
  },
  {
    id: 'avatar_c',
    name: 'Taro',
    presentation: 'male',
    gender: 'male',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'male', 'student', 'core', 'bundled'],
    emoji: '👨',
    thumbnail: '/avatar-previews/avatar_c.webp',
    url: '/avatars/AvatarSample_C.vrm',
    localUrl: '/avatars/AvatarSample_C.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_C.vrm',
    source: 'VRoid Studio Sample Model',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. VRoid Studio Sample Character C',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'VRoid anime male student character with standard humanoid rig.'
  },
  {
    id: 'avatar_orion',
    name: 'Orion',
    presentation: 'male',
    gender: 'male',
    category: 'stylized',
    style: 'sci-fi',
    tags: ['cc0', 'male', 'stylized', 'futuristic', 'sci-fi', 'core', 'bundled', 'robot'],
    emoji: '🧑',
    thumbnail: '/avatar-previews/avatar_orion.webp',
    url: '/avatars/Avatar_Orion.vrm',
    localUrl: '/avatars/Avatar_Orion.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/Avatar_Orion.vrm',
    source: 'Avatar Orion',
    sourceUrl: 'https://github.com/madjin/vrm-samples',
    license: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Madjin / VRM Samples (CC0 1.0)',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'Stylized male sci-fi humanoid avatar under CC0 public domain license.'
  },
  {
    id: 'avatar_victoria',
    name: 'Victoria',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'gothic', 'dress', 'bundled'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_victoria.webp',
    url: '/avatars/Victoria_Rubin.vrm',
    localUrl: '/avatars/Victoria_Rubin.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Victoria_Rubin.vrm',
    source: 'VRoid Victoria Rubin',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Victoria Rubin',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'VRoid anime character in elegant gothic dress.'
  },
  {
    id: 'avatar_shino',
    name: 'Shino',
    presentation: 'male',
    gender: 'male',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'male', 'casual', 'hoodie', 'bundled'],
    emoji: '👨',
    thumbnail: '/avatar-previews/avatar_shino.webp',
    url: '/avatars/Sendagaya_Shino.vrm',
    localUrl: '/avatars/Sendagaya_Shino.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shino.vrm',
    source: 'VRoid Sendagaya Shino',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Sendagaya Shino',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'VRoid casual male student avatar in modern streetwear.'
  },
  {
    id: 'avatar_seedsan',
    name: 'Seed-san',
    presentation: 'androgynous',
    gender: 'neutral',
    category: 'stylized',
    style: 'toon',
    tags: ['vrm-c', 'androgynous', 'mascot', 'virtualcast', 'bundled'],
    emoji: '🌱',
    thumbnail: '/avatar-previews/avatar_seedsan.webp',
    url: '/avatars/Seed-san.vrm',
    localUrl: '/avatars/Seed-san.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm',
    source: 'VirtualCast Seed-san',
    sourceUrl: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san',
    license: 'VRM Public License 1.0',
    licenseUrl: 'https://vrm.dev/en/licenses/1.0/index',
    attribution: 'VirtualCast, Inc. (VRM Public License 1.0)',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'Official VRM Consortium stylized humanoid mascot character Seed-san.'
  },
  {
    id: 'avatar_voxbot',
    name: 'VoxBot',
    presentation: 'unclassified',
    gender: 'neutral',
    category: 'robot',
    style: 'robotic',
    tags: ['voxel', 'robot', 'sci-fi', 'cryptovoxels', 'bundled'],
    emoji: '🤖',
    thumbnail: '/avatar-previews/avatar_voxbot.webp',
    url: '/avatars/cryptovoxels.vrm',
    localUrl: '/avatars/cryptovoxels.vrm',
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/cryptovoxels.vrm',
    source: 'Cryptovoxels Avatar',
    sourceUrl: 'https://github.com/madjin/vrm-samples',
    license: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Cryptovoxels / Madjin (CC0 1.0)',
    verified: true,
    bundled: true,
    loadingPriority: 'normal',
    cachePriority: 'normal',
    description: 'Stylized modular robotic voxel avatar designed for metaverse spaces.'
  },

  // ─── 2. REMOTE VERIFIED AVATARS (10 MODELS) ───
  {
    id: 'avatar_vita',
    name: 'Vita',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'sci-fi',
    tags: ['vroid', 'female', 'sci-fi', 'futuristic', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_vita.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vita.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vita.vrm',
    source: 'VRoid Vita',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Vita',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Futuristic female avatar with mechanical and sci-fi aesthetic.'
  },
  {
    id: 'avatar_vivi',
    name: 'Vivi',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'fantasy', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_vivi.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vivi.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vivi.vrm',
    source: 'VRoid Vivi',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Vivi',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Fantasy-themed female avatar character with styled twin tails.'
  },
  {
    id: 'avatar_shibu',
    name: 'Shibu',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'casual', 'remote'],
    emoji: '👧',
    thumbnail: '/avatar-previews/avatar_shibu.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shibu.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shibu.vrm',
    source: 'VRoid Sendagaya Shibu',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Sendagaya Shibu',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Casual female anime character from VRoid Studio.'
  },
  {
    id: 'avatar_kuro',
    name: 'Kuro',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'dark', 'cyber', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_kuro.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Darkness_Shibu.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Darkness_Shibu.vrm',
    source: 'VRoid Darkness Shibu',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Darkness Shibu',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Dark cyber styled female character with sharp monochrome design.'
  },
  {
    id: 'avatar_fumiriya',
    name: 'Fumiriya',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'school', 'uniform', 'remote'],
    emoji: '👧',
    thumbnail: '/avatar-previews/avatar_fumiriya.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sakurada_Fumiriya.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sakurada_Fumiriya.vrm',
    source: 'VRoid Sakurada Fumiriya',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. Sakurada Fumiriya',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'School uniform VRoid avatar with detailed hair textures.'
  },
  {
    id: 'avatar_meebit',
    name: 'Meebit',
    presentation: 'androgynous',
    gender: 'neutral',
    category: 'stylized',
    style: 'voxel',
    tags: ['voxel', 'stylized', 'community', 'remote', 'robot'],
    emoji: '🤖',
    thumbnail: '/avatar-previews/avatar_meebit.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/meebits/meebit_09842.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/meebits/meebit_09842.vrm',
    source: 'Meebits Collection',
    sourceUrl: 'https://github.com/madjin/vrm-samples',
    license: 'Public Domain / CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Larva Labs / Meebits Community',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Voxel stylized 3D avatar character #09842.'
  },
  {
    id: 'avatar_ren',
    name: 'Ren',
    presentation: 'male',
    gender: 'male',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'male', 'casual', 'remote'],
    emoji: '👨',
    thumbnail: '/avatar-previews/avatar_ren.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/masc_vroid.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/masc_vroid.vrm',
    source: 'VRoid Studio Masculine Base',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. VRoid Studio',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Modern male character base with sporty jacket.'
  },
  {
    id: 'avatar_maya',
    name: 'Maya',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vroid', 'female', 'casual', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_maya.webp',
    url: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/fem_vroid.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/fem_vroid.vrm',
    source: 'VRoid Studio Feminine Base',
    sourceUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    license: 'VRoid Sample Model Terms',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
    attribution: '(c) pixiv Inc. VRoid Studio',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Modern female character base with casual denim.'
  },
  {
    id: 'avatar_clara',
    name: 'Clara',
    presentation: 'female',
    gender: 'female',
    category: 'anime',
    style: 'anime',
    tags: ['vrm1', 'female', 'pixiv', 'vrm-c', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_clara.webp',
    url: 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm',
    source: 'Pixiv VRM 1.0 Sample',
    sourceUrl: 'https://github.com/vrm-c/vrm-specification',
    license: 'VRM Public License 1.0',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    attribution: '(c) 2022 pixiv Inc. VRM Public License 1.0',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'Official VRM 1.0 specification test avatar with advanced twist constraints.'
  },
  {
    id: 'avatar_alicia',
    name: 'Alicia',
    presentation: 'female',
    gender: 'female',
    category: 'community',
    style: 'anime',
    tags: ['dwango', 'vrm-c', 'female', 'alicia', 'community', 'remote'],
    emoji: '👩',
    thumbnail: '/avatar-previews/avatar_alicia.webp',
    url: 'https://raw.githubusercontent.com/vrm-c/UniVRM/master/Tests/Models/Alicia_vrm-0.51/AliciaSolid_vrm-0.51.vrm',
    localUrl: null,
    fallbackUrl: 'https://raw.githubusercontent.com/vrm-c/UniVRM/master/Tests/Models/Alicia_vrm-0.51/AliciaSolid_vrm-0.51.vrm',
    source: 'Dwango Alicia Solid',
    sourceUrl: 'https://github.com/vrm-c/UniVRM',
    license: 'Alicia Solid Terms / CC BY 4.0',
    licenseUrl: 'https://3d.nicovideo.jp/alicia/',
    attribution: '(c) DWANGO Co., Ltd.',
    verified: true,
    bundled: false,
    loadingPriority: 'low',
    cachePriority: 'low',
    description: 'The iconic reference avatar Alicia Solid from Dwango Co., Ltd. and VRM Consortium.'
  }
];

export class AvatarRegistry {
  constructor() {
    /** @type {Map<string, object>} id -> AvatarDefinition */
    this._avatars = new Map();

    /** @type {Set<string>} Set of favorited avatar IDs */
    this._favorites = new Set();

    /** @type {string[]} Array of recently used avatar IDs (ordered newest to oldest) */
    this._recents = [];

    this._loadPersistedState();
    this.registerMany(INITIAL_AVATAR_DEFINITIONS);
  }

  _loadPersistedState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const favs = localStorage.getItem('morphee_favorite_avatars');
      if (favs) {
        JSON.parse(favs).forEach((id) => this._favorites.add(id));
      }
      const recents = localStorage.getItem('morphee_recent_avatars');
      if (recents) {
        this._recents = JSON.parse(recents);
      }
    } catch (e) {
      console.warn('[AvatarRegistry] Could not parse localStorage preferences:', e);
    }
  }

  _savePersistedState() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        'morphee_favorite_avatars',
        JSON.stringify(Array.from(this._favorites))
      );
      localStorage.setItem('morphee_recent_avatars', JSON.stringify(this._recents));
    } catch (e) {
      console.warn('[AvatarRegistry] Could not save preferences to localStorage:', e);
    }
  }

  /**
   * Register a new avatar definition into the registry.
   * @param {object} def 
   */
  register(def) {
    if (!def?.id || !def?.name) {
      console.warn('[AvatarRegistry] Invalid avatar definition ignored:', def);
      return;
    }
    const presentation = def.presentation || def.gender || 'unclassified';
    this._avatars.set(def.id, {
      id: def.id,
      name: def.name,
      presentation,
      gender: def.gender || presentation, // Backward compatibility with gender field
      category: def.category || 'anime',
      style: def.style || 'anime',
      tags: Array.isArray(def.tags) ? def.tags : [],
      emoji: def.emoji || '👤',
      thumbnail: def.thumbnail || null,
      url: def.url || def.vrmUrl || '',
      localUrl: def.localUrl || (def.bundled ? def.url : null),
      fallbackUrl: def.fallbackUrl || '',
      source: def.source || 'Community',
      sourceUrl: def.sourceUrl || '',
      license: def.license || 'Custom',
      licenseUrl: def.licenseUrl || '',
      attribution: def.attribution || '',
      verified: !!def.verified,
      bundled: !!def.bundled,
      loadingPriority: def.loadingPriority || 'normal',
      cachePriority: def.cachePriority || 'normal',
      description: def.description || ''
    });
  }

  registerMany(definitions) {
    if (!Array.isArray(definitions)) return;
    for (const def of definitions) {
      this.register(def);
    }
  }

  get(id) {
    return this._avatars.get(id) || null;
  }

  getById(id) {
    return this.get(id);
  }

  has(id) {
    return this._avatars.has(id);
  }

  getAll() {
    return Array.from(this._avatars.values());
  }

  get size() {
    return this._avatars.size;
  }

  toggleFavorite(id) {
    if (!this.has(id)) return false;
    if (this._favorites.has(id)) {
      this._favorites.delete(id);
    } else {
      this._favorites.add(id);
    }
    this._savePersistedState();
    return this._favorites.has(id);
  }

  isFavorite(id) {
    return this._favorites.has(id);
  }

  recordUsage(id) {
    if (!this.has(id)) return;
    this._recents = [id, ...this._recents.filter((r) => r !== id)].slice(0, 10);
    this._savePersistedState();
  }

  getRecents() {
    return this._recents
      .map((id) => this.get(id))
      .filter((def) => def !== null);
  }

  /**
   * Filter and search avatar definitions using metadata only.
   * Zero Three.js or WebGL memory is touched during query operations.
   *
   * @param {object} [options]
   * @param {string} [options.search] Text search against name, tags, category, style, source, description
   * @param {string} [options.presentation] 'all' | 'female' | 'male' | 'androgynous' | 'unclassified'
   * @param {string} [options.gender] Backward compatible alias for presentation
   * @param {string} [options.category] 'all' | 'anime' | 'stylized' | 'robot' | 'community'
   * @param {string} [options.style] 'all' | 'anime' | 'sci-fi' | 'toon' | 'robotic' | 'voxel'
   * @param {boolean} [options.favoritesOnly]
   * @param {string} [options.tag]
   * @returns {Array<object>} Filtered metadata records
   */
  query(options = {}) {
    const {
      search = '',
      presentation = 'all',
      gender = 'all',
      category = 'all',
      style = 'all',
      favoritesOnly = false,
      tag = ''
    } = options;

    const queryTerm = search.trim().toLowerCase();
    const tagFilter = tag.trim().toLowerCase();
    const effectivePresentation = presentation !== 'all' ? presentation : (gender !== 'all' ? gender : 'all');

    return this.getAll().filter((avatar) => {
      // 1. Favorites filter
      if (favoritesOnly && !this.isFavorite(avatar.id)) {
        return false;
      }

      // 2. Presentation / Gender filter
      if (effectivePresentation && effectivePresentation !== 'all') {
        const matchesPresentation =
          (avatar.presentation && avatar.presentation.toLowerCase() === effectivePresentation.toLowerCase()) ||
          (avatar.gender && avatar.gender.toLowerCase() === effectivePresentation.toLowerCase());
        if (!matchesPresentation) {
          return false;
        }
      }

      // 3. Category filter
      if (category && category !== 'all' && avatar.category.toLowerCase() !== category.toLowerCase()) {
        return false;
      }

      // 4. Style filter
      if (style && style !== 'all' && avatar.style.toLowerCase() !== style.toLowerCase()) {
        return false;
      }

      // 5. Tag filter
      if (tagFilter && !avatar.tags.some((t) => t.toLowerCase() === tagFilter)) {
        return false;
      }

      // 6. Search text match across name, tags, category, style, source, description
      if (queryTerm) {
        const matchesName = avatar.name.toLowerCase().includes(queryTerm);
        const matchesSource = avatar.source.toLowerCase().includes(queryTerm);
        const matchesTag = avatar.tags.some((t) => t.toLowerCase().includes(queryTerm));
        const matchesCategory = avatar.category.toLowerCase().includes(queryTerm);
        const matchesStyle = avatar.style.toLowerCase().includes(queryTerm);
        const matchesDesc = avatar.description.toLowerCase().includes(queryTerm);
        if (!matchesName && !matchesSource && !matchesTag && !matchesCategory && !matchesStyle && !matchesDesc) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Caches a rendered thumbnail data URL for the specified avatar ID.
   * @param {string} id 
   * @param {string|null} dataUrl 
   * @returns {boolean}
   */
  setThumbnail(id, dataUrl) {
    const avatar = this._avatars.get(id);
    if (avatar) {
      avatar.thumbnail = dataUrl;
      return true;
    }
    return false;
  }

  /**
   * Gets cached thumbnail data URL for the specified avatar ID.
   * @param {string} id 
   * @returns {string|null}
   */
  getThumbnail(id) {
    return this._avatars.get(id)?.thumbnail || null;
  }
}

// Global registry singleton
export const avatarRegistry = new AvatarRegistry();
export default avatarRegistry;
