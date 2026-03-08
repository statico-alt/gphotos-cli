// Google Photos batchexecute RPC identifiers
// These are stable server-side method IDs, not minified/compiled names.
// They are defined in Google's internal protobuf service definitions and
// remain consistent across frontend builds.
//
// Source: reverse-engineering + xob0t/google_photos_web_client project
// Last verified: 2026-03-08

export const RPC = {
  // Library browsing
  GetLibraryPageByTakenDate: 'lcxiM',
  GetLibraryPageByUploadedDate: 'EzkLib',
  GetSearchPage: 'EzkLib',
  GetFavoritesPage: 'EzkLib',

  // Item details
  GetItemInfo: 'VrseUb',
  GetItemInfoExt: 'fDcn4b',
  GetBatchMediaInfo: 'EWgK9e',

  // Item mutations
  MoveToTrash: 'XwAOJf',
  RestoreFromTrash: 'XwAOJf',
  SetFavorite: 'Ftfh0',
  SetArchive: 'w7TP3c',
  SetItemTimestamp: 'DaSgWe',
  SetItemDescription: 'AQNOFd',
  SetItemGeoData: 'EtUHOe',

  // Albums
  CreateAlbum: 'OXvT9d',
  GetAlbumsPage: 'Z5xsfc',
  GetAlbumPage: 'snAcKc',
  AddItemsToNewAlbum: 'E1Cajb',
  AddItemsToExistingAlbum: 'E1Cajb',
  AddItemsToExistingSharedAlbum: 'laUYf',
  RemoveItemsFromAlbum: 'ycV3Nd',

  // Trash
  GetTrashPage: 'zy0IHe',

  // Sharing
  GetSharedLinksPage: 'F2A0H',
  SaveSharedMediaToLibrary: 'V8RKJ',
  GetPartnerSharedMedia: 'e9T5je',
  SavePartnerSharedMedia: 'Es7fke',

  // Upload
  CommitUpload: 'mdpdU',

  // Downloads
  GetDownloadToken: 'yCLA7',
  CheckDownloadToken: 'dnv2s',

  // User / account
  GetUserProfile: 'O3G8Nd',
  GetStorageQuota: 'EzwWhf',

  // Hash matching (dedup)
  GetRemoteMatchesByHash: 'swbisb',

  // Drive import
  ImportMediaFromDrive: 'SusGud',
} as const

export type RpcName = keyof typeof RPC
