export interface Photo {
  id: string
  url: string
  width: number
  height: number
  createdAt: number
  modifiedAt: number
  hash: string
  fileSize: number
  mediaType: number
}

export interface PhotoDetail extends Photo {
  downloadUrl: string
  ownerName: string
  ownerId: string
}

export interface AuthState {
  cookies: CookieData[]
  csrfToken: string
  userId: string
}

export interface CookieData {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: string
}
