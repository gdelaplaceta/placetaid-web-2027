import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import {
  Activity,
  AppWindow,
  ArrowDownUp,
  ArrowRight,
  BadgeCheck,
  Bell,
  Blocks,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Code2,
  Fingerprint,
  Image as ImageIcon,
  KeyRound,
  LockKeyhole,
  Mail,
  Monitor,
  Phone,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UserRoundPlus,
  UsersRound,
  X,
} from 'lucide-react'
import './App.css'

type Role = 'administrador' | 'miembro' | 'entidad' | 'visitante'
type IntegrationStatus = 'authorized' | 'disabled' | 'pending'
type AgeLimit = 0 | 16 | 18
type View = 'home' | 'applications' | 'users' | 'permissions' | 'gateway' | 'myPermissions' | 'simulator' | 'activity'
type ProtectedField = 'dip' | 'email' | 'phone' | 'photo' | 'identityVerified'
type UserStatus = 'active' | 'pending' | 'restricted' | 'suspended' | 'closed'
type ConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked'
type GatewayStage = 'entry' | 'password' | 'detected' | 'legal' | 'consent' | 'authenticated'
type LegalDocument = 'terms' | 'privacy'
type GatewayMethod = 'mobile' | 'authenticator' | 'desktop' | 'password'
type GatewayPreview = {
  app: { name: string; description: string; category: string; initials: string; color: string; logoUrl?: string; brandColor?: string }
  service: { name: string; description: string }
  destination: string
  requirements: { minAge: number; allowedRoles: Role[]; activeAccount: boolean; linkedMethod: boolean }
  disclosure: { base: string[]; optional: ProtectedField[]; unavailable: ProtectedField[] }
}
type GatewayResponse = {
  stage?: string
  error?: string
  login_correct?: boolean
  requestId?: string
  confirmationCode?: string
  method?: GatewayMethod
  claims?: Record<string, string | boolean | undefined>
  fields?: ProtectedField[]
  redirectUrl?: string
  reason?: string
  message?: string
  app?: { name?: string }
  service?: { name?: string }
  disclosure?: { base?: string[]; optional?: ProtectedField[]; unavailable?: ProtectedField[]; destination?: string | null }
}

const LEGAL_VERSION = 'v27-2026-10'

type Service = {
  id: string
  key?: string
  name: string
  description: string
  enabled: boolean
  minAge: AgeLimit
  roles: Role[] | null
}

type Integration = {
  id: string
  clientId?: string
  redirectUris?: string[]
  platforms?: string[]
  description?: string
  name: string
  category: string
  initials: string
  color: string
  logoUrl?: string
  brandColor?: string
  status: IntegrationStatus
  minAge: AgeLimit
  roles: Role[]
  scopes: Record<ProtectedField, boolean>
  services: Service[]
  updated: string
}

type AuditEntry = { id: string; action: string; subject: string; time: string }
type ConsentRecord = { appId: string; field: ProtectedField; status: ConsentStatus; updated: string }
type ManagedUser = {
  id: string
  dip: string
  placeid: string
  name: string
  surname: string
  birthDate: string
  email: string
  phone: string
  role: Role
  status: UserStatus
  identityVerified: boolean
  auth: { mobile: boolean; authenticator: boolean; desktop: boolean }
  appOverrides: Record<string, 'allow' | 'deny'>
  permissions: ConsentRecord[]
  legalAcceptedVersions?: string[]
  lastAccess: string
}

const roleLabels: Record<Role, string> = {
  administrador: 'Administración',
  miembro: 'Miembros',
  entidad: 'Entidades',
  visitante: 'Visitantes',
}

const roles: Role[] = ['administrador', 'miembro', 'entidad', 'visitante']

const initialIntegrations: Integration[] = [
  {
    id: 'banco', clientId: '79d7087aa027fac0250e832c4b5d39b2', name: 'Banco de La Placeta', category: 'Finanzas', initials: 'BL', color: 'green', status: 'authorized', minAge: 0,
    roles: ['administrador', 'miembro', 'entidad'],
    scopes: { dip: false, email: true, phone: false, photo: false, identityVerified: true }, updated: 'Hoy, 10:24',
    services: [
      { id: 'general', name: 'Acceso general', description: 'Inicio de sesión en el portal', enabled: true, minAge: 0, roles: ['administrador', 'miembro', 'entidad'] },
      { id: 'cuentas', name: 'Consulta de cuentas', description: 'Posición y movimientos', enabled: true, minAge: 16, roles: ['administrador', 'miembro', 'entidad'] },
      { id: 'tarjetas', name: 'Tarjetas', description: 'Gestión de tarjetas de pago', enabled: true, minAge: 18, roles: ['administrador', 'miembro'] },
      { id: 'financiacion', name: 'Financiación', description: 'Solicitudes y contratos', enabled: false, minAge: 18, roles: ['administrador', 'miembro', 'entidad'] },
    ],
  },
  {
    id: 'rsp', clientId: 'eaf341d5a71b9a3bfc01d0fc8c31ea01', name: 'RSP', category: 'Administración', initials: 'RS', color: 'coral', status: 'authorized', minAge: 16,
    roles: ['administrador', 'miembro'], scopes: { dip: false, email: true, phone: false, photo: false, identityVerified: true }, updated: 'Ayer, 16:08',
    services: [
      { id: 'panel', name: 'Panel de servicios', description: 'Acceso al panel de administración', enabled: true, minAge: 16, roles: ['administrador'] },
      { id: 'expedientes', name: 'Expedientes', description: 'Consulta de expedientes propios', enabled: true, minAge: 16, roles: ['administrador', 'miembro'] },
      { id: 'firma', name: 'Firma electrónica', description: 'Validación de identidad para firma', enabled: true, minAge: 18, roles: ['administrador', 'miembro'] },
    ],
  },
  {
    id: 'joven', clientId: 'placetajoven-web', name: 'Placeta Joven', category: 'Comunidad', initials: 'PJ', color: 'orange', status: 'authorized', minAge: 16,
    roles: ['miembro'], scopes: { dip: false, email: true, phone: false, photo: true, identityVerified: false }, updated: '28 oct 2026',
    services: [
      { id: 'ventajas', name: 'Ventajas', description: 'Catálogo de descuentos', enabled: true, minAge: 16, roles: ['miembro'] },
      { id: 'eventos', name: 'Eventos', description: 'Inscripción a actividades', enabled: true, minAge: 16, roles: ['miembro'] },
      { id: 'suscripcion', name: 'Suscripción', description: 'Gestión del plan joven', enabled: true, minAge: 18, roles: ['miembro'] },
    ],
  },
  {
    id: 'crm', clientId: 'ccb611655030bdadf7218418dc195dcb', name: 'CRM Grupo Placeta', category: 'Administración', initials: 'CR', color: 'blue', status: 'authorized', minAge: 18,
    roles: ['administrador', 'entidad'], scopes: { dip: false, email: true, phone: true, photo: false, identityVerified: true }, updated: '24 oct 2026',
    services: [
      { id: 'contactos', name: 'Contactos', description: 'Gestión de contactos', enabled: true, minAge: 18, roles: ['administrador', 'entidad'] },
      { id: 'informes', name: 'Informes', description: 'Informes internos', enabled: true, minAge: 18, roles: ['administrador'] },
    ],
  },
  {
    id: 'voley', clientId: 'voley-club', name: 'Voley Club La Placeta', category: 'Deporte', initials: 'VC', color: 'pink', status: 'authorized', minAge: 0,
    roles: ['miembro', 'visitante'], scopes: { dip: false, email: false, phone: false, photo: false, identityVerified: false }, updated: '20 oct 2026',
    services: [
      { id: 'area-jugador', name: 'Área del jugador', description: 'Perfil y calendario deportivo', enabled: true, minAge: 0, roles: ['miembro', 'visitante'] },
      { id: 'competicion', name: 'Competición', description: 'Inscripción a competiciones', enabled: true, minAge: 16, roles: ['miembro'] },
    ],
  },
  {
    id: 'bop', clientId: 'bop-web', name: 'Boletín Oficial (BOP)', category: 'Publicación', initials: 'BO', color: 'slate', status: 'pending', minAge: 0,
    roles: ['administrador', 'miembro'], scopes: { dip: false, email: false, phone: false, photo: false, identityVerified: false }, updated: 'Solicitud · 19 oct 2026',
    services: [{ id: 'lectura', name: 'Consulta de boletines', description: 'Acceso al archivo público', enabled: true, minAge: 0, roles: ['administrador', 'miembro'] }],
  },
]

const initialAudit: AuditEntry[] = [
  { id: '1', action: 'Servicio desactivado', subject: 'Banco de La Placeta · Financiación', time: 'Hoy, 10:24' },
  { id: '2', action: 'Permisos revisados', subject: 'RSP · Panel de servicios', time: 'Ayer, 16:08' },
  { id: '3', action: 'Integración autorizada', subject: 'Voley Club La Placeta', time: '20 oct 2026' },
]

const initialUsers: ManagedUser[] = [
  {
    id: 'user-lucia', dip: '12345678Z', placeid: 'PLID-26481', name: 'Lucía', surname: 'Ríos Valle', birthDate: '2009-04-18', email: 'lucia.rios@example.test', phone: '+34 600 123 456', role: 'miembro', status: 'active', identityVerified: true,
    auth: { mobile: true, authenticator: true, desktop: true }, appOverrides: {}, lastAccess: 'Hoy, 09:42',
    permissions: [
      { appId: 'joven', field: 'email', status: 'granted', updated: '02 oct 2026' },
      { appId: 'joven', field: 'phone', status: 'denied', updated: '02 oct 2026' },
      { appId: 'banco', field: 'email', status: 'pending', updated: 'Hoy, 09:40' },
      { appId: 'voley', field: 'photo', status: 'pending', updated: 'Ayer, 18:12' },
    ],
  },
  {
    id: 'user-mario', dip: '87654321X', placeid: 'PLID-51832', name: 'Mario', surname: 'Santos Gil', birthDate: '2011-09-03', email: 'mario.santos@example.test', phone: '+34 611 222 333', role: 'miembro', status: 'restricted', identityVerified: false,
    auth: { mobile: false, authenticator: true, desktop: false }, appOverrides: { crm: 'deny' }, lastAccess: 'Ayer, 17:26',
    permissions: [{ appId: 'banco', field: 'phone', status: 'pending', updated: 'Ayer, 17:28' }],
  },
  {
    id: 'user-eva', dip: '23456789A', placeid: 'PLID-93017', name: 'Eva', surname: 'Navarro León', birthDate: '1987-12-11', email: 'eva.navarro@example.test', phone: '+34 622 345 678', role: 'entidad', status: 'suspended', identityVerified: true,
    auth: { mobile: false, authenticator: false, desktop: true }, appOverrides: {}, lastAccess: '28 sep 2026', permissions: [{ appId: 'crm', field: 'email', status: 'granted', updated: '12 ago 2026' }],
  },
]

function resolveGatewayRequest() {
  const params = new URLSearchParams(window.location.search)
  const clientId = params.get('client_id') || params.get('clientId') || ''
  const legacyCallback = params.get('from') || ''
  const redirectUri = params.get('redirect_uri') || params.get('redirectUri') || legacyCallback
  const requestedService = params.get('service') || params.get('service_key') || ''
  return {
    bound: Boolean(clientId),
    valid: Boolean(clientId && redirectUri),
    redirectUri,
    state: params.get('state') || '',
    serviceKey: legacyCallback && requestedService.toLowerCase() === 'nexe' ? 'general' : requestedService,
  }
}

const initialGatewayRequest = resolveGatewayRequest()

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function statusLabel(status: IntegrationStatus) {
  if (status === 'authorized') return 'Autorizada'
  if (status === 'disabled') return 'Desactivada'
  return 'Pendiente'
}

function ageLabel(age: AgeLimit) {
  return age === 0 ? 'Todas las edades' : `${age}+ años`
}

function userStatusLabel(status: UserStatus) {
  return { active: 'Activo', pending: 'Pendiente', restricted: 'Restringido', suspended: 'Suspendido', closed: 'Cerrado' }[status]
}

function mapManagedUser(value: Partial<ManagedUser>): ManagedUser {
  const role = roles.includes(value.role as Role) ? value.role as Role : 'miembro'
  const statuses: UserStatus[] = ['active', 'pending', 'restricted', 'suspended', 'closed']
  return {
    id: String(value.id || ''),
    dip: String(value.dip || ''),
    placeid: String(value.placeid || ''),
    name: String(value.name || ''),
    surname: String(value.surname || ''),
    birthDate: String(value.birthDate || ''),
    email: String(value.email || ''),
    phone: value.phone ?? '',
    role,
    status: statuses.includes(value.status as UserStatus) ? value.status as UserStatus : 'pending',
    identityVerified: Boolean(value.identityVerified),
    auth: value.auth ?? { mobile: false, authenticator: false, desktop: false },
    appOverrides: value.appOverrides ?? {},
    permissions: value.permissions ?? [],
    legalAcceptedVersions: value.legalAcceptedVersions ?? [],
    lastAccess: String(value.lastAccess || ''),
  }
}

function consentStatusLabel(status: ConsentStatus) {
  return { pending: 'Pendiente', granted: 'Concedido', denied: 'No permitido', revoked: 'Revocado' }[status]
}

function authMethod(user: ManagedUser) {
  if (user.auth.mobile) return 'mobile'
  if (user.auth.authenticator) return 'authenticator'
  if (user.auth.desktop) return 'desktop'
  return null
}

function protectedFieldLabel(field: ProtectedField) {
  return { dip: 'DIP', email: 'Correo electrónico', phone: 'Número de teléfono', photo: 'Fotografía de perfil', identityVerified: 'Identidad verificada' }[field]
}

function gatewayClaimLabel(field: string) {
  const labels: Record<string, string> = {
    login_correct: 'Resultado de autenticación',
    over_16: 'Indicador: mayor de 16',
    over_18: 'Indicador: mayor de 18',
    name: 'Nombre',
    surname: 'Apellidos',
    identity_verified: 'Identidad verificada',
    identityVerified: 'Identidad verificada',
  }
  return labels[field] ?? field
}

function isShareableConsentField(field: ProtectedField) {
  return field !== 'phone' && field !== 'photo'
}

function calculateAge(birthDate: string) {
  const today = new Date()
  const birth = new Date(`${birthDate}T00:00:00`)
  return today.getFullYear() - birth.getFullYear() - (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0)
}

async function encodeApplicationLogo(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('El logo debe ser PNG, JPEG o WebP.')
  if (file.size > 1024 * 1024) throw new Error('El logo no puede superar 1 MB.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer el logo.'))
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = data
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo analizar el color del logo.')
  context.drawImage(image, 0, 0, 32, 32)
  const pixels = context.getImageData(0, 0, 32, 32).data
  const colors = new Map<string, { red: number; green: number; blue: number; count: number }>()
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    if (alpha < 100 || Math.max(r, g, b) - Math.min(r, g, b) < 28 || Math.max(r, g, b) > 245) continue
    const red = Math.round(r / 32) * 32
    const green = Math.round(g / 32) * 32
    const blue = Math.round(b / 32) * 32
    const key = `${red},${green},${blue}`
    const current = colors.get(key)
    colors.set(key, { red, green, blue, count: (current?.count || 0) + 1 })
  }
  const dominant = [...colors.values()].sort((left, right) => right.count - left.count)[0]
  const dominantChannels = dominant ? [dominant.red, dominant.green, dominant.blue] : []
  const brightnessScale = dominant ? Math.min(1, 170 / Math.max(...dominantChannels)) : 1
  const color = dominant
    ? `#${dominantChannels.map((part) => Math.round(part * brightnessScale).toString(16).padStart(2, '0')).join('')}`
    : '#6d28d9'
  return { data, contentType: file.type, brandColor: color }
}

function App() {
  const [integrations, setIntegrations] = useState(() => readStored('plid27.v27.integrations', initialIntegrations))
  const [audit, setAudit] = useState(() => readStored('plid27.v27.audit', initialAudit))
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers)
  const [selectedId, setSelectedId] = useState('banco')
  const [view, setView] = useState<View>(initialGatewayRequest.bound ? 'gateway' : 'home')
  const [query, setQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatus | 'all'>('all')
  const [selectedUserId, setSelectedUserId] = useState('user-lucia')
  const [statusFilter, setStatusFilter] = useState<'all' | IntegrationStatus>('all')
  const [newAppOpen, setNewAppOpen] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [newAppCategory, setNewAppCategory] = useState('Ecosistema')
  const [newAppRedirectUri, setNewAppRedirectUri] = useState('')
  const [newAppDescription, setNewAppDescription] = useState('')
  const [newAppLogo, setNewAppLogo] = useState<File | null>(null)
  const [newAppCredential, setNewAppCredential] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [newAppError, setNewAppError] = useState('')
  const [creatingApp, setCreatingApp] = useState(false)
  const [secretRotateTarget, setSecretRotateTarget] = useState<Integration | null>(null)
  const [rotatingSecret, setRotatingSecret] = useState(false)
  const [rotateSecretError, setRotateSecretError] = useState('')
  const [rotatedCredential, setRotatedCredential] = useState<{ appName: string; clientId: string; clientSecret: string; auditWarning: boolean } | null>(null)
  const [passwordResetTarget, setPasswordResetTarget] = useState<ManagedUser | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPasswordConfirmation, setAdminPasswordConfirmation] = useState('')
  const [adminPasswordError, setAdminPasswordError] = useState('')
  const [adminPasswordSaving, setAdminPasswordSaving] = useState(false)
  const [planInfoOpen, setPlanInfoOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [simAppId, setSimAppId] = useState('joven')
  const [simServiceId, setSimServiceId] = useState('ventajas')
  const [simUserId, setSimUserId] = useState('user-lucia')
  const [simAge, setSimAge] = useState(() => calculateAge(initialUsers[0].birthDate))
  const [simRole, setSimRole] = useState<Role>(initialUsers[0].role)
  const [gatewayDip, setGatewayDip] = useState('')
  const [gatewayStage, setGatewayStage] = useState<GatewayStage>('entry')
  const [gatewayUser, setGatewayUser] = useState<ManagedUser | null>(null)
  const [gatewayError, setGatewayError] = useState('')
  const [gatewayIdentifyRetrySeconds, setGatewayIdentifyRetrySeconds] = useState(0)
  const [gatewayNeedsEnrollment, setGatewayNeedsEnrollment] = useState(false)
  const [gatewayOtp, setGatewayOtp] = useState('')
  const [gatewayPassword, setGatewayPassword] = useState('')
  const [gatewayRequestId, setGatewayRequestId] = useState('')
  const [gatewayConfirmationCode, setGatewayConfirmationCode] = useState('')
  const [gatewayMethod, setGatewayMethod] = useState<GatewayMethod | null>(null)
  const [gatewayAppName, setGatewayAppName] = useState('')
  const [gatewayServiceName, setGatewayServiceName] = useState('')
  const [gatewayPreview, setGatewayPreview] = useState<GatewayPreview | null>(null)
  const [gatewayPreviewLoading, setGatewayPreviewLoading] = useState(initialGatewayRequest.bound)
  const [gatewayPreviewError, setGatewayPreviewError] = useState('')
  const [gatewayClaims, setGatewayClaims] = useState<Record<string, string | boolean | undefined> | null>(null)
  const [gatewayConsentFields, setGatewayConsentFields] = useState<ProtectedField[]>([])
  const [gatewayIntegrations, setGatewayIntegrations] = useState<Integration[]>([])
  const [gatewayBusy, setGatewayBusy] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null)
  const [consentPrompt, setConsentPrompt] = useState<{ userId: string; appId: string; field: ProtectedField } | null>(null)
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('plid27.adminToken') || '')
  const [adminSyncing, setAdminSyncing] = useState(false)
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'ready' | 'migration' | 'offline'>('checking')
  const [deviceBridgeConfigured, setDeviceBridgeConfigured] = useState(false)
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(true)

  useEffect(() => localStorage.setItem('plid27.v27.integrations', JSON.stringify(integrations)), [integrations])
  useEffect(() => localStorage.setItem('plid27.v27.audit', JSON.stringify(audit)), [audit])
  useEffect(() => {
    let active = true
    fetch('/api/health')
      .then(async (response) => {
        const status = await response.json()
        if (active) {
          setSupabaseStatus(status.ok ? 'ready' : status.migrationRequired ? 'migration' : 'offline')
          setDeviceBridgeConfigured(status.deviceBridgeConfigured === true)
          setPasswordLoginEnabled(status.passwordLoginEnabled !== false)
        }
      })
      .catch(() => { if (active) setSupabaseStatus('offline') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (gatewayIdentifyRetrySeconds <= 0) return
    const timer = window.setTimeout(() => setGatewayIdentifyRetrySeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [gatewayIdentifyRetrySeconds])
  useEffect(() => {
    if (!initialGatewayRequest.bound) return
    if (!initialGatewayRequest.valid) {
      setGatewayPreviewLoading(false)
      setGatewayPreviewError('La solicitud no incluye una aplicación y una dirección de retorno válidas.')
      return
    }
    let active = true
    const params = new URLSearchParams(window.location.search)
    const previewUrl = new URL('/api/public/authorize/preview', window.location.origin)
    previewUrl.searchParams.set('client_id', params.get('client_id') || params.get('clientId') || '')
    previewUrl.searchParams.set('redirect_uri', initialGatewayRequest.redirectUri)
    if (initialGatewayRequest.serviceKey) previewUrl.searchParams.set('service', initialGatewayRequest.serviceKey)
    fetch(previewUrl)
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'No se pudo validar la solicitud de la aplicación.')
        if (active) {
          setGatewayPreview(payload)
          setGatewayAppName(payload.app.name)
          setGatewayServiceName(payload.service.name)
        }
      })
      .catch((error) => {
        if (active) setGatewayPreviewError(error instanceof Error ? error.message : 'No se pudo validar la aplicación solicitante.')
      })
      .finally(() => { if (active) setGatewayPreviewLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    fetch('/api/public/session')
      .then(async (response) => {
        if (response.status === 401) return
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'No se pudo cargar la sesión PlacetaID.')
        if (active) {
          setGatewayUser(mapManagedUser(payload.user))
          setGatewayIntegrations(payload.integrations ?? [])
          if (!initialGatewayRequest.bound) setGatewayStage('authenticated')
        }
      })
      .catch((error) => console.error('[PlacetaID UI] No se pudo restaurar la sesión:', error))
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!['applications', 'users', 'permissions'].includes(view) || adminSyncing) return
    async function loadAdminCatalog() {
      let token = adminToken
      if (!token) {
        const key = window.prompt('Clave de Administración PlacetaID') || ''
        if (!key) { setView('home'); return }
        const session = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
        if (!session.ok) { showToast('No se pudo iniciar la sesión de Administración'); setView('home'); return }
        token = (await session.json()).token
        setAdminToken(token)
        localStorage.setItem('plid27.adminToken', token)
      }
      setAdminSyncing(true)
      const response = await fetch('/api/admin/apps', { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) {
        setIntegrations(await response.json())
        if (view === 'users' || view === 'permissions') {
          const userResponse = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
          const userPayload = await userResponse.json()
          if (!userResponse.ok) {
            if (userResponse.status === 401) { localStorage.removeItem('plid27.adminToken'); setAdminToken(''); showToast('La sesión de Administración ha caducado') }
            else showToast(userPayload.message || 'No se pudo cargar el directorio de identidades.')
          } else {
            const loadedUsers = (userPayload as Partial<ManagedUser>[]).map(mapManagedUser)
            setUsers(loadedUsers)
            if (loadedUsers[0]) setSelectedUserId((current) => loadedUsers.some((user) => user.id === current) ? current : loadedUsers[0].id)
          }
        }
      } else if (response.status === 401) { localStorage.removeItem('plid27.adminToken'); setAdminToken(''); showToast('La sesión de Administración ha caducado') }
      else {
        const payload = await response.json()
        showToast(payload.message || 'No se pudo cargar el catálogo desde Supabase')
      }
      setAdminSyncing(false)
    }
    void loadAdminCatalog().catch(() => { setAdminSyncing(false); showToast('API de Administración no disponible') })
  }, [view, adminToken])

  const selected = integrations.find((item) => item.id === selectedId) ?? integrations[0]
  const visibleIntegrations = useMemo(() => integrations.filter((item) => {
    const matchesQuery = `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'all' || item.status === statusFilter)
  }), [integrations, query, statusFilter])
  const authorizedCount = integrations.filter((item) => item.status === 'authorized').length
  const pendingCount = integrations.filter((item) => item.status === 'pending').length
  const restrictionCount = integrations.flatMap((item) => item.services).filter((service) => !service.enabled || service.minAge > 0).length
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0]
  const simIdentity = users.find((user) => user.id === simUserId) ?? users[0]
  const visibleUsers = users.filter((user) => {
    const matchesQuery = `${user.dip} ${user.placeid} ${user.name} ${user.surname} ${user.email}`.toLowerCase().includes(userQuery.toLowerCase())
    return matchesQuery && (userStatusFilter === 'all' || user.status === userStatusFilter)
  })
  const pendingConsentCount = users.reduce((count, user) => count + user.permissions.filter((permission) => permission.status === 'pending').length, 0)
  const isPublicView = view === 'home' || view === 'gateway' || view === 'myPermissions'

  const simApp = integrations.find((item) => item.id === simAppId)
  const simService = simApp?.services.find((service) => service.id === simServiceId) ?? simApp?.services[0]
  const simDecision = simIdentity && simApp && simService
    ? accessDecision({ ...simIdentity, role: simRole }, simApp, simService, simAge)
    : { allowed: false, reason: 'No hay una identidad disponible para simular.' }
  const simReason = simDecision.allowed ? '' : simDecision.reason

  function addAudit(action: string, subject: string) {
    setAudit((current) => [{ id: `${Date.now()}`, action, subject, time: 'Ahora' }, ...current].slice(0, 12))
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2400)
  }

  async function copyEndpoint(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      showToast(`${label} copiada`)
    } catch {
      showToast(`No se pudo copiar ${label.toLowerCase()}`)
    }
  }

  async function uploadApplicationLogo(appId: string, file: File) {
    const logo = await encodeApplicationLogo(file)
    const response = await fetch(`/api/admin/apps/${encodeURIComponent(appId)}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(logo),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message || 'No se pudo guardar el logo de la aplicación.')
    const updated = payload as Integration
    setIntegrations((current) => current.map((app) => app.id === appId
      ? { ...app, logoUrl: updated.logoUrl, brandColor: updated.brandColor, updated: 'Ahora' }
      : app))
    return updated
  }

  function updateIntegration(id: string, update: (item: Integration) => Integration) {
    setIntegrations((current) => {
      const next = current.map((item) => item.id === id ? update(item) : item)
      const changed = next.find((item) => item.id === id)
      if (changed && adminToken) void fetch(`/api/admin/apps/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: changed.name, description: changed.description || '', category: changed.category, redirect_uris: changed.redirectUris || [], status: changed.status, min_age: changed.minAge, allowed_roles: changed.roles, scopes: changed.scopes }) })
      return next
    })
  }

  function updateUser(id: string, update: (user: ManagedUser) => ManagedUser) {
    const currentUser = users.find((user) => user.id === id)
    if (!currentUser) return
    const changedUser = update(currentUser)
    setUsers((current) => current.map((user) => user.id === id ? changedUser : user))
    if (!adminToken || !/^\d+$/.test(id)) return
    void fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: changedUser.status, identityVerified: changedUser.identityVerified }),
    }).then(async (response) => {
      const payload = await response.json()
      if (!response.ok) showToast(payload.message || 'No se pudo guardar el estado de la identidad.')
    }).catch(() => showToast('No se pudo conectar con el directorio de identidades.'))
  }

  function updateConsent(userId: string, appId: string, field: ProtectedField, status: ConsentStatus) {
    if (gatewayUser?.id === userId && (status === 'granted' || status === 'denied' || status === 'revoked')) {
      void updateOwnConsent(appId, field, status)
      return
    }
    const app = integrations.find((item) => item.id === appId)
    if (!app?.scopes[field] && status === 'granted') {
      showToast('Administración no permite solicitar este dato a la aplicación')
      return
    }
    updateUser(userId, (user) => {
      const existing = user.permissions.some((permission) => permission.appId === appId && permission.field === field)
      return {
        ...user,
        permissions: existing
          ? user.permissions.map((permission) => permission.appId === appId && permission.field === field ? { ...permission, status, updated: 'Ahora' } : permission)
          : [...user.permissions, { appId, field, status, updated: 'Ahora' }],
      }
    })
    addAudit(status === 'granted' ? 'Titular concedió permiso' : status === 'revoked' ? 'Titular revocó permiso' : status === 'denied' ? 'Titular rechazó permiso' : 'Aplicación solicitó permiso', `${app?.name ?? appId} · ${protectedFieldLabel(field)}`)
    showToast(status === 'granted' ? 'Permiso concedido' : status === 'revoked' ? 'Permiso revocado' : status === 'denied' ? 'Solicitud rechazada' : 'Solicitud creada')
  }

  function requestConsent(userId: string, appId: string, field: ProtectedField) {
    const user = users.find((item) => item.id === userId)
    const existing = user?.permissions.find((permission) => permission.appId === appId && permission.field === field)
    if (userId !== gatewayUser?.id && (!existing || existing.status === 'denied' || existing.status === 'revoked')) updateConsent(userId, appId, field, 'pending')
    setConsentPrompt({ userId, appId, field })
  }

  function resolveConsentPrompt(status: 'granted' | 'denied') {
    if (!consentPrompt) return
    updateConsent(consentPrompt.userId, consentPrompt.appId, consentPrompt.field, status)
    setConsentPrompt(null)
  }

  function accessDecision(user: ManagedUser, app: Integration, service: Service, age = calculateAge(user.birthDate)) {
    if (user.status === 'suspended' || user.status === 'closed') return { allowed: false, reason: `Cuenta ${userStatusLabel(user.status).toLowerCase()}` }
    if (user.status === 'pending') return { allowed: false, reason: 'Identidad pendiente de verificación' }
    if (app.status !== 'authorized') return { allowed: false, reason: app.status === 'pending' ? 'Aplicación pendiente de autorización' : 'Aplicación desactivada por Administración' }
    if (user.appOverrides[app.id] === 'deny') return { allowed: false, reason: 'Bloqueada por Administración para este usuario' }
    if (!app.roles.includes(user.role) || (service.roles !== null && !service.roles.includes(user.role))) return { allowed: false, reason: 'Tipo de usuario no permitido' }
    if (!service.enabled) return { allowed: false, reason: 'Servicio desactivado por Administración' }
    const requiredAge = Math.max(app.minAge, service.minAge)
    if (age < requiredAge) return { allowed: false, reason: `Requiere ${requiredAge}+ años` }
    return { allowed: true, reason: 'Acceso permitido' }
  }

  function toggleUserApp(user: ManagedUser, app: Integration) {
    const blocked = user.appOverrides[app.id] === 'deny'
    const decision = blocked ? 'allow' : 'deny'
    updateUser(user.id, (current) => {
      const appOverrides = { ...current.appOverrides }
      if (blocked) delete appOverrides[app.id]
      else appOverrides[app.id] = 'deny'
      return { ...current, appOverrides }
    })
    if (adminToken && /^\d+$/.test(user.id)) {
      void fetch(`/api/admin/users/${encodeURIComponent(user.id)}/access/${encodeURIComponent(app.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ decision }),
      }).then(async (response) => {
        const payload = await response.json()
        if (!response.ok) showToast(payload.message || 'No se pudo guardar la regla de acceso.')
      }).catch(() => showToast('No se pudo conectar con la política de acceso.'))
    }
    addAudit(blocked ? 'Bloqueo individual retirado' : 'Aplicación bloqueada para identidad', `${user.name} ${user.surname} · ${app.name}`)
    showToast(blocked ? 'Regla individual retirada' : 'Acceso de la identidad bloqueado')
  }

  function toggleUserSuspension(user: ManagedUser) {
    const status: UserStatus = user.status === 'suspended' ? 'active' : 'suspended'
    updateUser(user.id, (current) => ({ ...current, status }))
    addAudit(status === 'suspended' ? 'Cuenta suspendida' : 'Cuenta reactivada', `${user.name} ${user.surname} · ${user.placeid}`)
    showToast(status === 'suspended' ? 'Cuenta suspendida' : 'Cuenta reactivada')
  }

  function closeUserSessions(user: ManagedUser) {
    if (!adminToken || !/^\d+$/.test(user.id)) {
      showToast('La sesión administrativa no está activa.')
      return
    }
    void fetch(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then(async (response) => {
      const payload = await response.json()
      if (!response.ok) {
        showToast(payload.message || 'No se pudieron revocar las sesiones.')
        return
      }
      updateUser(user.id, (current) => ({ ...current, auth: { mobile: false, authenticator: false, desktop: false } }))
      showToast('Sesiones y dispositivos revocados')
    }).catch(() => showToast('No se pudo conectar con PlacetaID.'))
    addAudit('Sesiones y dispositivos revocados', `${user.name} ${user.surname} · ${user.placeid}`)
  }

  async function submitAdminPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!passwordResetTarget || !adminToken || !/^\d+$/.test(passwordResetTarget.id)) {
      setAdminPasswordError('La sesión administrativa no está activa para esta identidad.')
      return
    }
    if (adminPassword.length < 8 || adminPassword.length > 256 || !/[A-Za-z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
      setAdminPasswordError('Usa entre 8 y 256 caracteres, con al menos una letra y un número.')
      return
    }
    if (adminPassword !== adminPasswordConfirmation) {
      setAdminPasswordError('Las contraseñas no coinciden.')
      return
    }
    setAdminPasswordSaving(true)
    setAdminPasswordError('')
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(passwordResetTarget.id)}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ password: adminPassword }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setAdminPasswordError(payload.message || 'No se pudo actualizar la contraseña.')
        return
      }
      updateUser(passwordResetTarget.id, (current) => ({ ...current, auth: { mobile: false, authenticator: false, desktop: false } }))
      addAudit('Contraseña restablecida por Administración', `${passwordResetTarget.name} ${passwordResetTarget.surname} · ${passwordResetTarget.placeid}`)
      showToast(payload.legacySynced
        ? 'Contraseña actualizada en PlacetaID y PL26; sesiones revocadas.'
        : 'Contraseña de PlacetaID actualizada; sesiones revocadas.')
      setPasswordResetTarget(null)
      setAdminPassword('')
      setAdminPasswordConfirmation('')
    } catch {
      setAdminPasswordError('No se pudo conectar con PlacetaID. Comprueba la conexión e inténtalo de nuevo.')
    } finally {
      setAdminPasswordSaving(false)
    }
  }

  async function submitGatewayDip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGatewayError('')
    setGatewayNeedsEnrollment(false)
    const dip = gatewayDip.replace(/[\s-]/g, '').toUpperCase()
    if (!/^\d{8}[A-Z]$/.test(dip)) {
      setGatewayError('Introduce el DIP completo: 8 números y una letra.')
      return
    }
    if (initialGatewayRequest.bound && !initialGatewayRequest.valid) {
      setGatewayError('La solicitud no incluye un client_id y redirect_uri válidos.')
      return
    }
    if (initialGatewayRequest.bound && !gatewayPreview) {
      setGatewayError(gatewayPreviewError || 'Aún no se ha podido verificar la aplicación solicitante.')
      return
    }
    setGatewayBusy(true)
    try {
      const params = new URLSearchParams(window.location.search)
      const response = await fetch('/api/public/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dip,
          ...(initialGatewayRequest.bound ? {
            clientId: params.get('client_id') || params.get('clientId'),
            redirectUri: initialGatewayRequest.redirectUri,
            serviceKey: initialGatewayRequest.serviceKey || undefined,
            state: params.get('state') || undefined,
          } : {}),
        }),
      })
      const payload: GatewayResponse = await response.json()
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('Retry-After'))
          if (Number.isFinite(retryAfter) && retryAfter > 0) setGatewayIdentifyRetrySeconds(Math.ceil(retryAfter))
        }
        if (payload.error === 'NO_ACTIVE_METHOD') {
          if (passwordLoginEnabled) {
            setGatewayPassword('')
            setGatewayStage('password')
            setGatewayMethod('password')
            setGatewayError('No hay un método vinculado activo. Puedes iniciar sesión temporalmente con la contraseña de PlacetaID.')
          } else {
            setGatewayNeedsEnrollment(true)
            setGatewayError('No hay un método activo. Vincula PlacetaID Móvil o Desktop para continuar.')
          }
        } else {
          setGatewayError(payload.message || 'No se pudo iniciar la autenticación.')
        }
        return
      }
      if (!payload.requestId || !payload.method) {
        setGatewayError('La API no devolvió una solicitud de autenticación válida.')
        return
      }
      setGatewayRequestId(payload.requestId)
      setGatewayConfirmationCode(payload.confirmationCode || '')
      setGatewayMethod(payload.method)
      setGatewayAppName(payload.app?.name || '')
      setGatewayServiceName(payload.service?.name || '')
      setGatewayClaims(null)
      setGatewayConsentFields([])
      setGatewayOtp('')
      setTermsAccepted(false)
      setPrivacyAccepted(false)
      setLegalDocument(null)
      setGatewayStage('detected')
      setGatewayPassword('')
    } catch {
      setGatewayError('No se pudo contactar con PlacetaID. Comprueba que la API esté activa.')
    } finally {
      setGatewayBusy(false)
    }
  }

  async function processGatewayResponse(payload: GatewayResponse) {
    if (payload.stage === 'legal_required') {
      setGatewayStage('legal')
      setGatewayError('')
      return
    }
    if (payload.stage === 'consent_required') {
      setGatewayConsentFields(payload.fields ?? [])
      setGatewayStage('consent')
      setGatewayError('')
      return
    }
    if (payload.stage === 'complete' && payload.login_correct) {
      if (payload.redirectUrl) {
        try {
          const target = new URL(payload.redirectUrl)
          if (initialGatewayRequest.bound) {
            const registeredCallback = new URL(initialGatewayRequest.redirectUri)
            if (target.origin !== registeredCallback.origin || target.pathname !== registeredCallback.pathname) {
              setGatewayError('PlacetaID devolvió una dirección de retorno distinta a la aplicación verificada. No se ha redirigido el acceso.')
              return
            }
          } else if (target.origin !== window.location.origin) {
            setGatewayError('La dirección de retorno no es válida. No se ha redirigido el acceso.')
            return
          }
          window.location.replace(target.toString())
        } catch {
          setGatewayError('PlacetaID devolvió una dirección de retorno no válida. No se ha redirigido el acceso.')
        }
        return
      }
      if (initialGatewayRequest.bound) {
        setGatewayError('La identidad se autenticó, pero falta la dirección de retorno segura de la aplicación. Vuelve a iniciar el acceso desde la aplicación; si persiste, contacta con Administración.')
        return
      }
      setGatewayClaims(payload.claims ?? null)
      setGatewayError('')
      try {
        const sessionResponse = await fetch('/api/public/session')
        const sessionPayload = await sessionResponse.json()
        if (sessionResponse.ok) {
          setGatewayUser(mapManagedUser(sessionPayload.user))
          setGatewayIntegrations(sessionPayload.integrations ?? [])
        } else {
          setGatewayError(sessionPayload.message || 'Inicio completado, pero no se pudo cargar el perfil.')
        }
      } catch {
        setGatewayError('Inicio completado, pero no se pudo cargar el perfil de Supabase.')
      }
      setGatewayStage('authenticated')
      return
    }
    if (payload.stage === 'denied') {
      setGatewayError(payload.reason ? `PlacetaID denegó el acceso (${payload.reason}).` : 'PlacetaID denegó el acceso.')
      return
    }
    setGatewayError(payload.message || 'La autenticación no se ha completado.')
  }

  async function confirmGatewayIdentity() {
    if (!gatewayRequestId || !gatewayMethod) {
      setGatewayError('No hay una solicitud de autenticación activa. Vuelve a introducir tu DIP.')
      return
    }

    if (gatewayMethod === 'authenticator' && !/^\d{6}$/.test(gatewayOtp)) {
      setGatewayError('Introduce el código de seis cifras del Autentificador.')
      return
    }
    setGatewayBusy(true)
    try {
      if (gatewayMethod === 'authenticator') {
        const response = await fetch('/api/public/authenticate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: gatewayRequestId, code: gatewayOtp }),
        })
        const payload: GatewayResponse = await response.json()
        if (!response.ok) {
          setGatewayError(payload.message || 'El código del Autentificador no es válido.')
          return
        }
        await processGatewayResponse(payload)
        return
      }

      setGatewayError('Aprueba la solicitud desde tu dispositivo vinculado…')
      const pollUntil = Date.now() + 295_000
      while (Date.now() < pollUntil) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        const response = await fetch(`/api/public/auth-requests/${encodeURIComponent(gatewayRequestId)}`)
        const payload: GatewayResponse = await response.json()
        if (!response.ok) {
          setGatewayError(payload.message || 'No se pudo consultar la solicitud.')
          return
        }
        if (payload.stage === 'waiting') continue
        await processGatewayResponse(payload)
        return
      }
      setGatewayError('La solicitud ha caducado o no fue aprobada. Vuelve a iniciar el acceso para generar otra.')
    } catch {
      setGatewayError('No se pudo completar la autenticación con el servidor.')
    } finally {
      setGatewayBusy(false)
    }
  }

  async function submitGatewayPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const dip = gatewayDip.replace(/[\s-]/g, '').toUpperCase()
    if (!gatewayPassword) {
      setGatewayError('Introduce la contraseña de tu cuenta PlacetaID.')
      return
    }
    setGatewayBusy(true)
    setGatewayError('')
    try {
      const params = new URLSearchParams(window.location.search)
      const response = await fetch('/api/public/password-authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dip,
          password: gatewayPassword,
          requestId: gatewayRequestId || undefined,
          ...(initialGatewayRequest.bound ? {
            clientId: params.get('client_id') || params.get('clientId'),
            redirectUri: initialGatewayRequest.redirectUri,
            serviceKey: initialGatewayRequest.serviceKey || undefined,
            state: params.get('state') || undefined,
          } : {}),
        }),
      })
      const payload: GatewayResponse = await response.json()
      if (!response.ok) {
        setGatewayError(payload.message || 'No se pudo validar la contraseña.')
        return
      }
      setGatewayPassword('')
      await processGatewayResponse(payload)
    } catch {
      setGatewayError('No se pudo conectar con PlacetaID para validar la contraseña.')
    } finally {
      setGatewayBusy(false)
    }
  }

  async function acceptLegalDocuments() {
    if (!gatewayRequestId || !termsAccepted || !privacyAccepted) {
      setGatewayError('Acepta los términos y la política de privacidad para continuar.')
      return
    }
    setGatewayBusy(true)
    try {
      const response = await fetch('/api/public/accept-legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: gatewayRequestId, accepted: true }),
      })
      const payload: GatewayResponse = await response.json()
      if (!response.ok) {
        setGatewayError(payload.message || 'No se pudieron registrar las aceptaciones.')
        return
      }
      await processGatewayResponse(payload)
    } catch {
      setGatewayError('No se pudo registrar la aceptación en PlacetaID.')
    } finally {
      setGatewayBusy(false)
    }
  }

  async function decideGatewayConsent(field: ProtectedField, decision: 'granted' | 'denied') {
    if (!gatewayRequestId) return
    setGatewayBusy(true)
    try {
      const response = await fetch('/api/public/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: gatewayRequestId, field, decision }),
      })
      const payload: GatewayResponse = await response.json()
      if (!response.ok) {
        setGatewayError(payload.message || 'No se pudo guardar el consentimiento.')
        return
      }
      await processGatewayResponse(payload)
    } catch {
      setGatewayError('No se pudo guardar tu decisión en PlacetaID.')
    } finally {
      setGatewayBusy(false)
    }
  }

  async function updateOwnConsent(appId: string, field: ProtectedField, status: 'granted' | 'denied' | 'revoked') {
    try {
      const response = await fetch('/api/public/session/consents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, field, decision: status }),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast(payload.message || 'No se pudo actualizar el permiso.')
        return
      }
      setGatewayUser((current) => current ? {
        ...current,
        permissions: [
          ...current.permissions.filter((permission) => permission.appId !== appId || permission.field !== field),
          { appId, field, status, updated: payload.updated },
        ],
      } : current)
      showToast(status === 'granted' ? 'Permiso concedido' : 'Permiso revocado')
    } catch {
      showToast('No se pudo conectar con PlacetaID.')
    }
  }

  async function logoutGatewayUser() {
    try {
      const response = await fetch('/api/public/logout', { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) {
        showToast(payload.message || 'No se pudo cerrar la sesión.')
        return
      }
      setGatewayUser(null)
      setGatewayIntegrations([])
      setGatewayStage('entry')
      setGatewayRequestId('')
      setGatewayConfirmationCode('')
      setGatewayMethod(null)
      setGatewayClaims(null)
      setGatewayDip('')
      setGatewayError('')
      setView('gateway')
    } catch {
      showToast('No se pudo conectar con PlacetaID para cerrar la sesión.')
    }
  }

  function rejectLegalDocuments() {
    setGatewayStage('entry')
    setGatewayRequestId('')
    setGatewayConfirmationCode('')
    setGatewayMethod(null)
    setGatewayUser(null)
    setGatewayError('Para usar PlacetaID debes aceptar los términos y la política de privacidad.')
  }

  function toggleStatus(item: Integration) {
    const next: IntegrationStatus = item.status === 'authorized' ? 'disabled' : 'authorized'
    updateIntegration(item.id, (current) => ({ ...current, status: next, updated: 'Ahora' }))
    addAudit(next === 'authorized' ? 'Aplicación autorizada' : 'Aplicación desactivada', item.name)
    showToast(next === 'authorized' ? 'Integración autorizada' : 'Integración desactivada')
  }

  async function addIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newAppName.trim()
    if (!name) return
    setCreatingApp(true)
    setNewAppError('')
    try {
      const response = await fetch('/api/admin/apps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name,
          category: newAppCategory.trim() || 'Ecosistema',
          description: newAppDescription.trim(),
          redirectUris: [newAppRedirectUri.trim()],
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setNewAppError(payload.message || 'No se pudo guardar la integración en Supabase.')
        return
      }
      if (!payload.app?.id || !payload.app?.clientId || !payload.clientSecret) {
        throw new Error('Supabase creó la aplicación, pero no devolvió sus credenciales.')
      }
      const item: Integration = { ...payload.app, updated: 'Ahora' }
      setIntegrations((current) => [item, ...current.filter((existing) => existing.id !== item.id)])
      setSelectedId(item.id)
      setNewAppCredential({ clientId: item.clientId || '', clientSecret: payload.clientSecret })
      if (newAppLogo) {
        try {
          await uploadApplicationLogo(item.id, newAppLogo)
        } catch (error) {
          setNewAppError(error instanceof Error ? error.message : 'La aplicación se creó, pero no se pudo guardar su logo.')
        }
      }
      setStatusFilter('all')
      addAudit('Nueva solicitud de integración guardada en Supabase', name)
      showToast('Aplicación creada en Supabase')
    } catch (error) {
      setNewAppError(error instanceof Error ? error.message : 'No se pudo conectar con la API.')
    } finally {
      setCreatingApp(false)
    }
  }

  async function copyCredential(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      showToast('Copiado al portapapeles')
    } catch {
      showToast('No se pudo copiar. Selecciona el valor manualmente.')
    }
  }

  async function rotateApplicationSecret() {
    if (!secretRotateTarget || !adminToken) return
    setRotatingSecret(true)
    setRotateSecretError('')
    try {
      const response = await fetch(`/api/admin/apps/${encodeURIComponent(secretRotateTarget.id)}/rotate-secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'No se pudo regenerar el secreto de la aplicación.')
      if (!payload.clientId || !payload.clientSecret) throw new Error('La API no devolvió el nuevo secreto. Comprueba la integración antes de volver a intentarlo.')
      setRotatedCredential({
        appName: secretRotateTarget.name,
        clientId: payload.clientId,
        clientSecret: payload.clientSecret,
        auditWarning: payload.auditWarning === true,
      })
      setSecretRotateTarget(null)
      addAudit('Secreto de integración regenerado', secretRotateTarget.name)
      showToast('Secreto nuevo generado; el anterior ha dejado de funcionar')
    } catch (error) {
      setRotateSecretError(error instanceof Error ? error.message : 'No se pudo regenerar el secreto.')
    } finally {
      setRotatingSecret(false)
    }
  }

  function toggleRole(id: string, role: Role) {
    updateIntegration(id, (item) => ({
      ...item,
      roles: item.roles.includes(role) ? item.roles.filter((value) => value !== role) : [...item.roles, role],
      updated: 'Ahora',
    }))
  }

  function toggleServiceRole(appId: string, serviceId: string, role: Role) {
    updateIntegration(appId, (item) => ({
      ...item,
      services: item.services.map((service) => service.id !== serviceId ? service : {
        ...service,
        roles: (service.roles ?? item.roles).includes(role)
          ? (service.roles ?? item.roles).filter((value) => value !== role)
          : [...(service.roles ?? item.roles), role],
      }),
      updated: 'Ahora',
    }))
  }

  function updateService(appId: string, serviceId: string, patch: Partial<Service>) {
    updateIntegration(appId, (item) => ({
      ...item,
      services: item.services.map((service) => service.id === serviceId ? { ...service, ...patch } : service),
      updated: 'Ahora',
    }))
  }

  function changeSimApp(id: string) {
    setSimAppId(id)
    const firstService = integrations.find((item) => item.id === id)?.services[0]
    setSimServiceId(firstService?.id ?? '')
  }

  const scopes: { id: ProtectedField; label: string; note: string }[] = [
    { id: 'dip', label: 'DIP', note: 'Identificador personal; solo si el titular lo acepta explícitamente' },
    { id: 'email', label: 'Correo electrónico', note: 'Requiere consentimiento individual' },
    { id: 'phone', label: 'Número de teléfono', note: 'No disponible en v27; no se transmite' },
    { id: 'photo', label: 'Fotografía de perfil', note: 'No disponible en v27; no se transmite' },
    { id: 'identityVerified', label: 'Identidad verificada', note: 'Solo resultado; el documento nunca se comparte' },
  ]
  const personalPermissionRows = gatewayUser
    ? gatewayIntegrations.flatMap((app) => scopes.filter((scope) => app.scopes[scope.id]).map((scope) => ({ app, scope, record: gatewayUser.permissions.find((permission) => permission.appId === app.id && permission.field === scope.id) })))
    : []
  const requestingAppLogo = gatewayPreview?.app.logoUrl
    || (gatewayPreview?.app.name.toLowerCase().includes('nexe') ? '/nexe-logo.png' : '')
  const gatewayBrandColor = gatewayStage !== 'entry'
    ? '#6d28d9'
    : /^#[\da-f]{6}$/i.test(gatewayPreview?.app.brandColor || '')
      ? gatewayPreview?.app.brandColor || '#6d28d9'
      : gatewayPreview?.app.name.toLowerCase().includes('nexe')
        ? '#163d35'
        : '#6d28d9'

  return (
    <div className={`${isPublicView ? 'public-shell' : 'app-shell'} ${isPublicView && initialGatewayRequest.bound ? 'public-shell-oauth' : ''}`} style={isPublicView ? { '--gateway-brand': gatewayBrandColor } as CSSProperties : undefined}>
      {!isPublicView && <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="PlacetaID v27 inicio" onClick={(event) => { event.preventDefault(); setView('gateway') }}>
          <span className="brand-mark"><Fingerprint size={22} strokeWidth={1.8} /></span>
          <span className="brand-copy"><strong>placeta<span>id</span></strong><small>GOBIERNO DE IDENTIDAD</small></span>
          <span className="version-tag">27</span>
        </a>

        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <div className="workspace-switcher"><span className="workspace-avatar">G</span><span><strong>Grupo La Placeta</strong><small>Administración central</small></span><ChevronDown size={15} /></div>

        <nav className="primary-nav" aria-label="Navegación principal">
          <div className="nav-caption">CONTROL</div>
          <button className={`nav-item ${view === 'applications' ? 'active' : ''}`} onClick={() => setView('applications')}><Blocks size={17} /><span>Aplicaciones</span><span className="nav-count">{integrations.length}</span></button>
          <div className="nav-caption nav-caption-spaced">IDENTIDAD</div>
          <button className={`nav-item ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}><UserRound size={17} /><span>Usuarios</span></button>
          <button className={`nav-item ${view === 'permissions' ? 'active' : ''}`} onClick={() => setView('permissions')}><CheckCheck size={17} /><span>Permisos personales</span>{pendingConsentCount > 0 && <span className="nav-count">{pendingConsentCount}</span>}</button>
          <div className="nav-caption nav-caption-spaced">ACCESO</div>
          <button className="nav-item" onClick={() => setView('gateway')}><Fingerprint size={17} /><span>Pasarela DIP</span></button>
          <button className={`nav-item ${view === 'simulator' ? 'active' : ''}`} onClick={() => setView('simulator')}><ShieldCheck size={17} /><span>Simulador de acceso</span></button>
          <button className={`nav-item ${view === 'activity' ? 'active' : ''}`} onClick={() => setView('activity')}><Activity size={17} /><span>Registro de actividad</span></button>
          <div className="nav-caption nav-caption-spaced">SISTEMA</div>
          <button className="nav-item" onClick={() => showToast('La configuración global estará disponible al conectar el backend')}><SlidersHorizontal size={17} /><span>Configuración global</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><CircleHelp size={16} /></span><span><strong>Centro de ayuda</strong><small>Políticas de identidad</small></span><ArrowRight size={14} /></div>
          <div className="admin-profile"><span className="profile-avatar">AM</span><span><strong>Administración</strong><small>Control central</small></span><ChevronDown size={15} /></div>
        </div>
      </aside>}

      <main className={isPublicView ? 'public-main' : 'main-area'}>
        {isPublicView ? <>
          <header className="public-topbar"><div className="public-brand-pair"><button className="public-brand" aria-label="PlacetaID" onClick={() => setView('gateway')}><span className="brand-mark"><Fingerprint size={21} /></span><span><strong>placeta<span>id</span></strong><small>IDENTIDAD DIGITAL</small></span></button>{view === 'gateway' && initialGatewayRequest.bound && requestingAppLogo && <><span className="public-brand-arrow" aria-label={`aplicación solicitante: ${gatewayPreview?.app.name}`}><ArrowRight size={18} /></span><img className="public-requesting-app-logo" src={requestingAppLogo} alt={`Logo de ${gatewayPreview?.app.name}`} /></>}</div><div className="public-topbar-actions">{view === 'myPermissions' && <button className="public-action" onClick={() => setView('gateway')}><ArrowRight className="back-arrow" size={15} />Pasarela</button>}{gatewayStage === 'authenticated' && gatewayUser && view === 'gateway' && <button className="public-action" onClick={() => setView('myPermissions')}><LockKeyhole size={15} />Mis permisos</button>}{gatewayStage === 'authenticated' && gatewayUser && <button className="public-action" onClick={() => void logoutGatewayUser()}>Cerrar sesión</button>}<button className="admin-entry" onClick={() => setView('applications')}><LockKeyhole size={14} />Administración</button></div></header>
        </> : <>
          <header className="topbar">
            <div className="breadcrumbs"><span>PlacetaID</span><ChevronRight size={14} /><strong>{{ applications: 'Aplicaciones', users: 'Usuarios', permissions: 'Permisos personales', gateway: 'Pasarela DIP', myPermissions: 'Mis permisos', simulator: 'Simulador de acceso', activity: 'Registro de actividad' }[view]}</strong></div>
            <div className="topbar-actions"><span className={`environment-pill system-${supabaseStatus}`}><span />{supabaseStatus === 'ready' ? 'SUPABASE EN LÍNEA' : supabaseStatus === 'checking' ? 'CONECTANDO…' : supabaseStatus === 'migration' ? 'MIGRACIÓN PENDIENTE' : 'API SIN CONEXIÓN'}</span><button className="icon-button" aria-label="Notificaciones" onClick={() => showToast('No hay notificaciones nuevas')}><Bell size={17} /><i /></button><span className="topbar-divider" /><span className="topbar-admin">AM</span></div>
          </header>
          <div className={`prototype-banner system-banner-${supabaseStatus}`}><Sparkles size={15} /><span><strong>{supabaseStatus === 'ready' ? deviceBridgeConfigured ? 'PlacetaID v27 · conectado' : 'Supabase conectado · puente de dispositivos pendiente' : supabaseStatus === 'checking' ? 'Comprobando el servicio' : supabaseStatus === 'migration' ? 'Falta aplicar la migración' : 'PlacetaID no está conectado'}</strong><span>{supabaseStatus === 'ready' ? deviceBridgeConfigured ? 'Aplicaciones y autenticación usan Supabase; el puente seguro de dispositivos está configurado.' : 'Supabase está activo, pero falta configurar PLACETAID_V27_DEVICE_KEY en el servidor para sincronizar los dispositivos.' : supabaseStatus === 'migration' ? 'Aplica la migración v27 antes de usar el catálogo.' : supabaseStatus === 'offline' ? 'Comprueba el servidor API y las credenciales de Supabase.' : 'Verificando API y tablas de Supabase…'}</span></span><button onClick={() => fetch('/api/health').then((response) => response.json()).then((health) => { setSupabaseStatus(health.ok ? 'ready' : health.migrationRequired ? 'migration' : 'offline'); setDeviceBridgeConfigured(health.deviceBridgeConfigured === true); showToast(health.ok ? 'Conexión Supabase verificada' : 'Supabase necesita atención') }).catch(() => { setSupabaseStatus('offline'); showToast('No se pudo contactar con la API') })}>Comprobar <ArrowRight size={14} /></button></div>
        </>}

        {view === 'home' && <div className="public-home">
          <section className="public-home-hero">
            <div className="public-home-copy"><span className="public-kicker">IDENTIDAD DIGITAL · PLAN 2027</span><h1>Tu identidad.<br /><em>Tu decisión.</em></h1><p>PlacetaID permite entrar en los servicios de La Placeta sin compartir más datos de los necesarios.</p><div className="public-home-actions"><span className="home-access-note"><LockKeyhole size={16} /> El acceso se inicia desde una aplicación autorizada mediante <code>client_id</code>.</span></div></div>
            <div className="public-home-card"><span className="home-card-icon"><Fingerprint size={25} /></span><span className="public-kicker">PLACETAID</span><h2>Acceso seguro<br />para todo el ecosistema.</h2><div className="home-card-line"><ShieldCheck size={16} /><span>Sin contraseñas compartidas</span></div><div className="home-card-line"><LockKeyhole size={16} /><span>Tú decides cada dato</span></div></div>
          </section>
          <section className="public-home-features"><div><span>01</span><h3>Identifícate</h3><p>Usa tu DIP y el método de acceso que tengas vinculado.</p></div><div><span>02</span><h3>Revisa</h3><p>Comprueba qué aplicación solicita el acceso y para qué servicio.</p></div><div><span>03</span><h3>Decide</h3><p>Concede o revoca datos protegidos cuando quieras.</p></div></section>
          <section className="public-home-cta"><div><span className="public-kicker">CONTROL DEL TITULAR</span><h2>La identidad es tuya.</h2></div><span className="home-access-note"><LockKeyhole size={15} /> Inicio delegado por la aplicación solicitante</span></section>
        </div>}

        {view === 'applications' && (
          <div className="page-content">
            <section className="page-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" />GOBIERNO DE ACCESO</div><h1>Aplicaciones</h1><p>Decide qué servicios del ecosistema pueden usar PlacetaID y bajo qué condiciones.</p></div>
              <button className="button-primary" disabled={supabaseStatus !== 'ready' || !adminToken} onClick={() => { setNewAppCredential(null); setNewAppError(''); setNewAppOpen(true) }}><Plus size={16} />Nueva integración</button>
            </section>

            <section className="metrics-row" aria-label="Resumen del catálogo">
              <div className="metric-item"><span className="metric-icon metric-ink"><Blocks size={17} /></span><span><strong>{integrations.length}</strong><small>Integraciones</small></span><span className="metric-note">en catálogo</span></div>
              <div className="metric-item"><span className="metric-icon metric-green"><BadgeCheck size={17} /></span><span><strong>{authorizedCount}</strong><small>Autorizadas</small></span><span className="metric-note"><i className="dot dot-green" />listas para acceso</span></div>
              <div className="metric-item"><span className="metric-icon metric-orange"><ShieldAlert size={17} /></span><span><strong>{restrictionCount}</strong><small>Reglas activas</small></span><span className="metric-note">edad o servicio</span></div>
              <div className="metric-item"><span className="metric-icon metric-blue"><ClipboardCheck size={17} /></span><span><strong>{pendingCount}</strong><small>Por revisar</small></span><span className="metric-note">solicitudes nuevas</span></div>
            </section>

            <section className="catalog-layout">
              <div className="catalog-panel">
                <div className="catalog-toolbar"><div className="section-title"><div><h2>Catálogo de aplicaciones</h2><p>Integraciones que solicitan acceso a PlacetaID</p></div><span className="total-chip">{visibleIntegrations.length} resultados</span></div>
                  <div className="filters-row"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aplicación..." /><kbd>⌘ K</kbd></label><label className="filter-select"><ArrowDownUp size={14} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | IntegrationStatus)} aria-label="Filtrar por estado"><option value="all">Todos los estados</option><option value="authorized">Autorizadas</option><option value="disabled">Desactivadas</option><option value="pending">Pendientes</option></select><ChevronDown size={13} /></label></div>
                </div>

                <div className="integration-table-wrap"><table className="integration-table"><thead><tr><th>APLICACIÓN</th><th>ESTADO</th><th>ACCESO</th><th>SERVICIOS</th><th aria-label="Abrir detalle" /></tr></thead><tbody>
                  {visibleIntegrations.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : ''} onClick={() => setSelectedId(item.id)}>
                    <td><button className="app-name-cell" onClick={() => setSelectedId(item.id)}><span className={`app-mark app-mark-${item.color}`}>{item.logoUrl ? <img src={item.logoUrl} alt="" /> : item.initials}</span><span className="app-cell-copy"><strong>{item.name}</strong><small>{item.category}</small></span></button></td>
                    <td><span className={`status-badge status-${item.status}`}><i />{statusLabel(item.status)}</span></td>
                    <td><span className="age-cell"><span className="age-dot" />{ageLabel(item.minAge)}</span></td>
                    <td><span className="services-count">{item.services.filter((service) => service.enabled).length}<span> / {item.services.length}</span></span></td>
                    <td><button className="row-open" aria-label={`Editar ${item.name}`} onClick={() => setSelectedId(item.id)}><ChevronRight size={16} /></button></td>
                  </tr>)}
                  {visibleIntegrations.length === 0 && <tr><td colSpan={5} className="empty-state">No hay aplicaciones que coincidan con la búsqueda.</td></tr>}
                </tbody></table></div>
                <div className="table-footer"><span><span className="live-dot" />Sincronización local activa</span><span>Actualizado hace un momento</span></div>
              </div>

              {selected && <aside className="policy-panel">
                <div className="policy-section integration-endpoint-section">
                  <div className="policy-section-heading"><div><h3>URLs exactas para la aplicación</h3><p>Usa estas direcciones para integrar PlacetaID v27</p></div><Code2 size={16} /></div>
                  <div className="endpoint-row"><span className="field-label">Client ID</span><code>{selected.clientId ?? 'Pendiente de registrar'}</code></div>
                  <label className="field-label" htmlFor="redirect-uris">Callbacks permitidos</label>
                  <textarea id="redirect-uris" className="redirect-uri-input" rows={3} value={(selected.redirectUris ?? []).join('\n')} placeholder="https://app.ejemplo.org/placetaid/callback" onChange={(event) => updateIntegration(selected.id, (item) => ({ ...item, redirectUris: event.target.value.split(/\n|,/).map((uri) => uri.trim()).filter(Boolean), updated: 'Ahora' }))} />
                  <small className="field-help">Cada <code>redirect_uri</code> debe coincidir exactamente, incluido el protocolo, dominio, puerto y ruta.</small>
                  {(selected.redirectUris ?? []).map((redirectUri) => {
                    const serviceKey = selected.services.find((service) => service.enabled && service.key)?.key || 'general'
                    const loginUrl = new URL('/', window.location.origin)
                    loginUrl.searchParams.set('client_id', selected.clientId || '')
                    loginUrl.searchParams.set('redirect_uri', redirectUri)
                    loginUrl.searchParams.set('service', serviceKey)
                    loginUrl.searchParams.set('state', 'REEMPLAZAR_POR_STATE_ALEATORIO')
                    return <div className="endpoint-value" key={redirectUri}>
                      <span className="field-label">Inicio de sesión v27 · {serviceKey}</span>
                      <div className="endpoint-copy-row"><code>{loginUrl.toString()}</code><button type="button" className="icon-button" aria-label="Copiar URL de inicio de sesión" onClick={() => void copyEndpoint('URL de inicio de sesión', loginUrl.toString())}><ClipboardCheck size={15} /></button></div>
                      <small className="field-help">Genera un <code>state</code> aleatorio nuevo por intento y valida que vuelva sin cambios en el callback.</small>
                    </div>
                  })}
                  <div className="endpoint-value">
                    <span className="field-label">Canje del código · solo servidor</span>
                    <div className="endpoint-copy-row"><code>{new URL('/api/public/exchange', window.location.origin).toString()}</code><button type="button" className="icon-button" aria-label="Copiar endpoint de canje" onClick={() => void copyEndpoint('Endpoint de canje', new URL('/api/public/exchange', window.location.origin).toString())}><ClipboardCheck size={15} /></button></div>
                    <small className="field-help">Usa <code>POST</code> con <code>client_id</code>, <code>client_secret</code>, <code>code</code> y <code>redirect_uri</code>. Nunca pongas el secreto en el navegador.</small>
                  </div>
                  <div className="endpoint-value credential-management-row">
                    <div><span className="field-label">Secreto de cliente · solo servidor</span><small className="field-help">No se puede consultar de nuevo; regenera uno si ya no lo tienes. El anterior dejará de funcionar.</small></div>
                    <button type="button" className="button-quiet" disabled={!adminToken || !selected.clientId} onClick={() => { setRotateSecretError(''); setSecretRotateTarget(selected) }}><KeyRound size={13} />Regenerar secreto</button>
                  </div>
                  <label className="field-label" htmlFor="platforms">Plataformas compatibles</label>
                  <input id="platforms" className="redirect-uri-input" value={(selected.platforms ?? ['Web', 'Apple', 'Android', 'Chrome Extension', 'Windows Desktop']).join(', ')} onChange={(event) => updateIntegration(selected.id, (item) => ({ ...item, platforms: event.target.value.split(',').map((platform) => platform.trim()).filter(Boolean), updated: 'Ahora' }))} />
                  <small className="field-help">La aplicación abre la pasarela v27; su servidor canjea el código de un solo uso.</small>
                </div>
                <div className="policy-topline"><span className="eyebrow">FICHA DE INTEGRACIÓN</span><button className="more-button" aria-label="Más opciones" onClick={() => showToast('No hay más acciones disponibles en la vista previa')}><span /><span /><span /></button></div>
                <div className="policy-app-heading"><span className={`app-mark app-mark-large app-mark-${selected.color}`}>{selected.logoUrl ? <img src={selected.logoUrl} alt="" /> : selected.initials}</span><div><h2>{selected.name}</h2><span>{selected.category} <span className="separator-dot">·</span> ID {selected.id.toUpperCase()}</span></div></div>
                <label className="app-logo-upload"><span>{selected.logoUrl ? <img src={selected.logoUrl} alt="" /> : <ImageIcon size={18} />}</span><span><strong>{selected.logoUrl ? 'Cambiar logo' : 'Subir logo de la aplicación'}</strong><small>PNG, JPEG o WebP · máximo 1 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadApplicationLogo(selected.id, file).then(() => showToast('Logo de aplicación actualizado')).catch((error) => showToast(error instanceof Error ? error.message : 'No se pudo subir el logo')); event.currentTarget.value = '' }} /></label>
                <div className="authorization-row"><div><strong>{selected.status === 'authorized' ? 'Integración autorizada' : selected.status === 'pending' ? 'Solicitud pendiente' : 'Integración desactivada'}</strong><small>{selected.status === 'authorized' ? 'Puede iniciar el flujo de acceso' : selected.status === 'pending' ? 'Aún no puede iniciar sesión' : 'El acceso está bloqueado para todos'}</small></div><button className={`switch ${selected.status === 'authorized' ? 'switch-on' : ''}`} role="switch" aria-checked={selected.status === 'authorized'} aria-label="Autorizar aplicación" onClick={() => toggleStatus(selected)}><span /></button></div>

                <div className="policy-section"><div className="policy-section-heading"><div><h3>Reglas de acceso</h3><p>La aplicación y sus servicios</p></div><LockKeyhole size={16} /></div>
                  <label className="field-label" htmlFor="app-age">Edad mínima de la aplicación</label><div className="select-control"><select id="app-age" value={selected.minAge} onChange={(event) => updateIntegration(selected.id, (item) => ({ ...item, minAge: Number(event.target.value) as AgeLimit, updated: 'Ahora' }))}><option value={0}>Sin mínimo de edad</option><option value={16}>A partir de 16 años</option><option value={18}>A partir de 18 años</option></select><ChevronDown size={14} /></div>
                  <div className="roles-heading"><span className="field-label">Tipos de usuario permitidos</span><span className="role-hint">{selected.roles.length} de {roles.length}</span></div>
                  <div className="role-options">{roles.map((role) => <label className="role-option" key={role}><input type="checkbox" checked={selected.roles.includes(role)} onChange={() => toggleRole(selected.id, role)} /><span className="custom-check"><Check size={11} /></span><span>{roleLabels[role]}</span></label>)}</div>
                </div>

                <div className="policy-section services-section"><div className="policy-section-heading"><div><h3>Servicios</h3><p>Control individual de funciones</p></div><span className="count-bubble">{selected.services.filter((service) => service.enabled).length}/{selected.services.length}</span></div>
                  <div className="service-list">{selected.services.map((service) => <div className={`service-item ${service.enabled ? '' : 'service-disabled'}`} key={service.id}>
                    <div className="service-row"><button className={`service-toggle ${service.enabled ? 'checked' : ''}`} role="checkbox" aria-checked={service.enabled} aria-label={`${service.enabled ? 'Desactivar' : 'Activar'} ${service.name}`} onClick={() => updateService(selected.id, service.id, { enabled: !service.enabled })}>{service.enabled && <Check size={12} />}</button><div className="service-copy"><strong>{service.name}</strong><small>{service.description}</small></div><div className="service-age"><select aria-label={`Edad mínima de ${service.name}`} value={service.minAge} onChange={(event) => updateService(selected.id, service.id, { minAge: Number(event.target.value) as AgeLimit })}><option value={0}>Todas</option><option value={16}>16+</option><option value={18}>18+</option></select><ChevronDown size={11} /></div></div>
                    <details className="service-roles"><summary>Tipos de usuario <ChevronDown size={12} /></summary><div className="service-role-list">{roles.map((role) => <label key={role}><input type="checkbox" checked={service.roles === null ? selected.roles.includes(role) : service.roles.includes(role)} onChange={() => toggleServiceRole(selected.id, service.id, role)} /><span>{roleLabels[role]}</span></label>)}</div></details>
                  </div>)}</div>
                </div>

                <div className="policy-section data-section"><div className="policy-section-heading"><div><h3>Datos de la identidad</h3><p>Los datos protegidos requieren consentimiento</p></div><UserRound size={16} /></div>
                  <div className="basic-data-list">{['Login correcto', 'Mayor de 16 / 18', 'Nombre y apellidos'].map((item) => <span key={item}><Check size={11} />{item}<small>Siempre</small></span>)}</div>
                  <div className="basic-data-caption">El DIP es un dato protegido que requiere permiso administrativo y consentimiento expreso del titular.</div>
                  <div className="scope-list">{scopes.map((scope) => <div className={`scope-row ${scope.id === 'email' || scope.id === 'dip' ? 'scope-sensitive' : ''}`} key={scope.id}><span className="scope-copy"><strong>{scope.label}{(scope.id === 'email' || scope.id === 'dip') && <span className="sensitive-tag">PROTEGIDO</span>}</strong><small>{scope.note}</small></span>{isShareableConsentField(scope.id) ? <label className="data-policy-control"><span>Acceso</span><select aria-label={`Acceso a ${scope.label}`} value={selected.scopes[scope.id] ? 'consent' : 'never'} onChange={(event) => { const canRequest = event.target.value === 'consent'; updateIntegration(selected.id, (item) => ({ ...item, scopes: { ...item.scopes, [scope.id]: canRequest }, updated: 'Ahora' })); addAudit('Política de dato protegido modificada', `${selected.name} · ${scope.label} · ${canRequest ? 'Con consentimiento' : 'Nunca'}`) }}><option value="never">Nunca</option><option value="consent">Si acepta</option></select><ChevronDown size={11} /></label> : <span className="data-policy-unavailable">No disponible</span>}</div>)}</div>
                </div>
                <div className="policy-footer"><span><Shield size={14} />Modificado: {selected.updated}</span><button onClick={() => { setView('simulator'); changeSimApp(selected.id) }}>Probar acceso <ArrowRight size={14} /></button></div>
              </aside>}
            </section>
          </div>
        )}

        {view === 'users' && <div className="page-content users-page">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />DIRECTORIO DE IDENTIDAD</div><h1>Usuarios</h1><p>Consulta el estado de identidad, acceso y dispositivos vinculados.</p></div><span className="simulator-tag"><UserRoundPlus size={14} />{users.length} IDENTIDADES</span></section>
          <div className="users-layout">
            <section className="users-list-panel"><div className="users-list-heading"><div><h2>Buscar usuarios</h2><p>DIP, PlacetaID, nombre o correo</p></div><span className="total-chip">{visibleUsers.length} resultados</span></div>
              <label className="search-field user-search"><Search size={16} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Buscar identidad..." /></label>
              <div className="user-filter-row"><UsersRound size={14} /><select aria-label="Filtrar por estado" value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value as UserStatus | 'all')}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="pending">Pendientes</option><option value="restricted">Restringidos</option><option value="suspended">Suspendidos</option><option value="closed">Cerrados</option></select><ChevronDown size={13} /></div>
              <div className="user-results">{visibleUsers.map((user) => <button className={`user-result ${selectedUser?.id === user.id ? 'user-result-active' : ''}`} key={user.id} onClick={() => setSelectedUserId(user.id)}><span className="user-avatar">{user.name.slice(0, 1)}{user.surname.slice(0, 1)}</span><span className="user-result-copy"><strong>{user.name} {user.surname}</strong><small>{user.placeid} · {user.dip}</small></span><span className={`user-state-dot user-state-${user.status}`} title={userStatusLabel(user.status)} /></button>)}{visibleUsers.length === 0 && <p className="user-empty">No hay identidades que coincidan.</p>}</div>
            </section>

            {selectedUser && <section className="user-detail-panel">
              <div className="user-profile-heading"><span className="user-avatar user-avatar-large">{selectedUser.name.slice(0, 1)}{selectedUser.surname.slice(0, 1)}</span><div className="user-profile-name"><div className="eyebrow">FICHA DE USUARIO</div><h2>{selectedUser.name} {selectedUser.surname}</h2><span>{selectedUser.placeid} <span className="separator-dot">·</span> {calculateAge(selectedUser.birthDate)} años</span></div><label className={`user-status-select user-status-${selectedUser.status}`}><select aria-label="Estado de la cuenta" value={selectedUser.status} onChange={(event) => { const status = event.target.value as UserStatus; updateUser(selectedUser.id, (current) => ({ ...current, status })); addAudit(`Estado de identidad cambiado a ${userStatusLabel(status)}`, `${selectedUser.name} ${selectedUser.surname}`) }}>{(['active', 'pending', 'restricted', 'suspended', 'closed'] as UserStatus[]).map((status) => <option value={status} key={status}>{userStatusLabel(status)}</option>)}</select><ChevronDown size={12} /></label></div>
              <div className="user-password-action-row"><div><strong>Credenciales de acceso</strong><small>Restablece la contraseña y revoca las sesiones y dispositivos activos.</small></div><button className="button-primary" disabled={!adminToken || !/^\d+$/.test(selectedUser.id)} title={!adminToken ? 'Inicia sesión en Administración para continuar.' : !/^\d+$/.test(selectedUser.id) ? 'Esta ficha no corresponde a una identidad real de Supabase.' : undefined} onClick={() => { setPasswordResetTarget(selectedUser); setAdminPassword(''); setAdminPasswordConfirmation(''); setAdminPasswordError('') }}><KeyRound size={14} />Cambiar contraseña</button>{(!adminToken || !/^\d+$/.test(selectedUser.id)) && <small className="user-password-action-note">{!adminToken ? 'Inicia sesión en Administración para habilitar esta acción.' : 'Disponible solo para identidades reales cargadas desde Supabase.'}</small>}</div>

              <section className="user-detail-section"><div className="user-section-heading"><div><h3>Identidad</h3><p>Datos de referencia de la cuenta</p></div><BadgeCheck size={16} /></div><div className="identity-facts"><div><span>PLACETAID</span><strong>{selectedUser.placeid}</strong></div><div><span>DIP</span><strong>{selectedUser.dip}</strong></div><div><span>NOMBRE COMPLETO</span><strong>{selectedUser.name} {selectedUser.surname}</strong></div><div><span>FECHA DE NACIMIENTO</span><strong>{selectedUser.birthDate}</strong></div><div><span>CORREO REGISTRADO</span><strong>{selectedUser.email}</strong></div><div><span>TELÉFONO REGISTRADO</span><strong>{selectedUser.phone}</strong></div><div><span>ÚLTIMO ACCESO</span><strong>{selectedUser.lastAccess}</strong></div><div><span>VERIFICACIÓN</span><strong className={selectedUser.identityVerified ? 'verified-text' : 'unverified-text'}>{selectedUser.identityVerified ? 'Identidad verificada' : 'Pendiente de verificar'}</strong></div></div></section>

              <section className="user-detail-section"><div className="user-section-heading"><div><h3>Métodos de autenticación</h3><p>La pasarela usa la primera sesión disponible</p></div><KeyRound size={16} /></div><div className="auth-methods-row">{[{ key: 'mobile', label: 'PlacetaID móvil', icon: <Smartphone size={16} /> }, { key: 'authenticator', label: 'Autentificador', icon: <KeyRound size={16} /> }, { key: 'desktop', label: 'PlacetaID Desktop', icon: <Monitor size={16} /> }].map((method) => <div className={`auth-method-chip ${selectedUser.auth[method.key as keyof ManagedUser['auth']] ? 'auth-method-active' : ''}`} key={method.key}>{method.icon}<span>{method.label}</span><i /></div>)}</div><div className="auth-priority-note"><Fingerprint size={13} />Prioridad detectada: <strong>{authMethod(selectedUser) === 'mobile' ? 'PlacetaID móvil' : authMethod(selectedUser) === 'authenticator' ? 'Autentificador' : authMethod(selectedUser) === 'desktop' ? 'PlacetaID Desktop' : 'sin sesión disponible'}</strong></div></section>

              <section className="user-detail-section"><div className="user-section-heading"><div><h3>Acceso a aplicaciones</h3><p>Evaluación individual según edad, rol y restricciones</p></div><AppWindow size={16} /></div><div className="user-app-access-list">{integrations.map((app) => { const service = app.services[0]; const decision = accessDecision(selectedUser, app, service); const blocked = selectedUser.appOverrides[app.id] === 'deny'; return <div className="user-app-entry" key={app.id}><div className="user-app-access"><span className={`app-mark app-mark-${app.color}`}>{app.initials}</span><span className="user-app-name"><strong>{app.name}</strong><small>{decision.reason}</small></span><span className={`access-result ${decision.allowed ? 'access-result-yes' : 'access-result-no'}`}><i />{decision.allowed ? 'Permitida' : 'Bloqueada'}</span><button className="user-app-toggle" aria-label={`${blocked ? 'Retirar bloqueo de' : 'Bloquear'} ${app.name}`} title={blocked ? 'Retirar bloqueo individual' : 'Bloquear para esta identidad'} onClick={() => toggleUserApp(selectedUser, app)}>{blocked ? <Check size={14} /> : <LockKeyhole size={14} />}</button></div><details className="user-service-details"><summary>{app.services.filter((item) => accessDecision(selectedUser, app, item).allowed).length} de {app.services.length} servicios disponibles <ChevronDown size={12} /></summary><div>{app.services.map((item) => { const result = accessDecision(selectedUser, app, item); return <span key={item.id}><strong>{item.name}</strong><small className={result.allowed ? 'service-result-ok' : 'service-result-no'}>{result.allowed ? 'Disponible' : result.reason}</small></span>})}</div></details></div>})}</div></section>

              <section className="user-detail-section"><div className="user-section-heading"><div><h3>Permisos personales</h3><p>Administración consulta; el titular concede o revoca</p></div><CheckCheck size={16} /></div>{selectedUser.permissions.length === 0 ? <p className="no-permissions">Esta identidad aún no tiene solicitudes de datos protegidos.</p> : <div className="user-consent-summary">{selectedUser.permissions.map((permission) => <div key={`${permission.appId}-${permission.field}`}><span>{integrations.find((item) => item.id === permission.appId)?.name ?? permission.appId}</span><strong>{protectedFieldLabel(permission.field)}</strong><span className={`consent-status consent-${permission.status}`}>{consentStatusLabel(permission.status)}</span><time>{permission.updated}</time></div>)}</div>}<button className="text-action" onClick={() => setView('permissions')}>Gestionar permisos del titular <ArrowRight size={13} /></button></section>

              <section className="user-security-actions"><div><ShieldAlert size={16} /><span><strong>Seguridad de la cuenta</strong><small>Las acciones quedan registradas en auditoría.</small></span></div><button className="button-quiet" onClick={() => closeUserSessions(selectedUser)}><Monitor size={13} />Cerrar sesiones</button><button className={selectedUser.status === 'suspended' ? 'button-quiet' : 'button-danger'} onClick={() => toggleUserSuspension(selectedUser)}>{selectedUser.status === 'suspended' ? <Check size={13} /> : <LockKeyhole size={13} />}{selectedUser.status === 'suspended' ? 'Reactivar' : 'Suspender'}</button></section>
            </section>}
          </div>
        </div>}

        {view === 'permissions' && <div className="page-content permissions-page">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />CONSENTIMIENTO DEL TITULAR</div><h1>Permisos personales</h1><p>Los permisos son específicos por aplicación y por dato; el titular puede revocarlos en cualquier momento.</p></div><span className="simulator-tag"><LockKeyhole size={14} />CONTROL DEL USUARIO</span></section>
          <section className="permissions-panel"><div className="permissions-toolbar"><div><h2>Permisos del titular</h2><p>Administración consulta el estado. Solo el titular puede conceder o revocar.</p></div><label className="permission-user-select"><UserRound size={15} /><select aria-label="Usuario titular" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{users.map((user) => <option value={user.id} key={user.id}>{user.name} {user.surname} · {user.placeid}</option>)}</select><ChevronDown size={13} /></label></div>
            {selectedUser && <div className="consent-owner"><span className="user-avatar">{selectedUser.name.slice(0, 1)}{selectedUser.surname.slice(0, 1)}</span><div><strong>{selectedUser.name} {selectedUser.surname}</strong><small>{selectedUser.placeid} · {selectedUser.dip}</small></div><span>{selectedUser.permissions.filter((permission) => permission.status === 'pending').length} pendientes</span></div>}
            <div className="consent-requests-list">{(selectedUser?.permissions ?? []).map((permission) => { const app = integrations.find((item) => item.id === permission.appId); const allowedByAdmin = Boolean(app?.scopes[permission.field] && app.status === 'authorized'); return <article className="consent-request-row" key={`${permission.appId}-${permission.field}`}><span className={`consent-field-icon consent-field-${permission.field}`}>{permission.field === 'dip' ? <Fingerprint size={17} /> : permission.field === 'email' ? <Mail size={17} /> : permission.field === 'phone' ? <Phone size={17} /> : permission.field === 'photo' ? <ImageIcon size={17} /> : <BadgeCheck size={17} />}</span><div className="consent-request-copy"><div className="consent-request-title"><strong>{app?.name ?? permission.appId}</strong><span className={`consent-status consent-${permission.status}`}>{consentStatusLabel(permission.status)}</span></div><span>{protectedFieldLabel(permission.field)}</span><small>{permission.status === 'pending' ? `${app?.name ?? 'La aplicación'} quiere acceder a este dato.` : `Actualizado ${permission.updated}`}</small>{!allowedByAdmin && <small className="admin-disallowed">La aplicación no tiene autorización administrativa para solicitar este dato.</small>}</div><div className="consent-actions">{permission.status === 'pending' && <span className="admin-pending-note">Esperando decisión del titular</span>}{permission.status === 'granted' && <span className="admin-pending-note">El titular concedió el permiso</span>}{permission.status === 'denied' && <span className="admin-pending-note">El titular rechazó el permiso</span>}{permission.status === 'revoked' && <span className="admin-pending-note">El titular revocó el permiso</span>}</div></article>})}{(selectedUser?.permissions ?? []).length === 0 && <div className="consent-empty"><LockKeyhole size={19} /><strong>Sin permisos registrados</strong><span>Cuando una aplicación solicite un dato protegido, aparecerá aquí para que el titular decida.</span></div>}</div>
            <div className="permission-principle"><ShieldCheck size={16} /><span><strong>Consentimiento independiente.</strong> Permitir el correo no concede acceso al teléfono ni a la foto. Revocar bloquea inmediatamente ese dato en la respuesta de PlacetaID.</span></div>
          </section>
        </div>}

        {view === 'myPermissions' && <div className="page-content my-permissions-page">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />TU CONTROL DE PRIVACIDAD</div><h1>Mis permisos</h1><p>Decide qué datos protegidos puede utilizar cada aplicación. Puedes cambiarlo cuando quieras.</p></div><span className="simulator-tag"><LockKeyhole size={14} />TITULAR</span></section>
          {gatewayUser ? <section className="my-permissions-panel"><div className="consent-owner"><span className="user-avatar">{gatewayUser.name.slice(0, 1)}{gatewayUser.surname.slice(0, 1)}</span><div><strong>{gatewayUser.name} {gatewayUser.surname}</strong><small>{gatewayUser.placeid} · Identidad verificada en PlacetaID</small></div><span>{personalPermissionRows.filter((row) => row.record?.status === 'granted' && isShareableConsentField(row.scope.id)).length} concedidos</span></div><div className="my-permission-list">{personalPermissionRows.map(({ app, scope, record }) => <article className="my-permission-row" key={`${app.id}-${scope.id}`}><span className={`consent-field-icon consent-field-${scope.id}`}>{scope.id === 'dip' ? <Fingerprint size={17} /> : scope.id === 'email' ? <Mail size={17} /> : scope.id === 'phone' ? <Phone size={17} /> : scope.id === 'photo' ? <ImageIcon size={17} /> : <BadgeCheck size={17} />}</span><span className="my-permission-copy"><strong>{app.name}</strong><span>{scope.label}</span><small>{!isShareableConsentField(scope.id) ? 'Este dato no se comparte en el flujo actual.' : record ? `Actualizado ${record.updated}` : 'Este permiso todavía no ha sido concedido.'}</small></span><span className={`consent-status consent-${record?.status ?? 'revoked'}`}>{!isShareableConsentField(scope.id) ? 'No disponible' : record ? consentStatusLabel(record.status) : 'No concedido'}</span>{record?.status === 'granted' ? <button className="button-quiet revoke-button" onClick={() => updateConsent(gatewayUser.id, app.id, scope.id, 'revoked')}>Revocar</button> : !isShareableConsentField(scope.id) ? null : !record || record.status === 'denied' || record.status === 'revoked' ? <button className="button-quiet" disabled={!app.scopes[scope.id] || app.status !== 'authorized'} onClick={() => requestConsent(gatewayUser.id, app.id, scope.id)}>Solicitar permiso</button> : <span className="admin-pending-note">Solicitud pendiente</span>}</article>)}</div><div className="permission-principle"><ShieldCheck size={16} /><span><strong>Tu decisión es independiente por aplicación y dato.</strong> Si revocas un permiso, ese dato deja de incluirse en las siguientes respuestas de PlacetaID.</span></div></section> : <section className="my-permissions-panel my-permissions-locked"><LockKeyhole size={20} /><strong>Identifícate para revisar tus permisos</strong><button className="button-primary" onClick={() => setView('gateway')}>Ir a la pasarela <ArrowRight size={14} /></button></section>}
        </div>}

        {view === 'gateway' && <div className={`page-content gateway-page ${initialGatewayRequest.bound ? 'gateway-page-bound' : ''}`} data-gateway-stage={gatewayStage}>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />AUTENTICACIÓN SEGURA</div><h1>{gatewayPreview ? `Acceso a ${gatewayPreview.app.name}` : 'Accede con PlacetaID'}</h1><p>{gatewayPreview ? `Confirma tu identidad y volverás de forma segura a ${gatewayPreview.app.name}.` : 'Tu DIP localiza la identidad. El acceso se confirma con un método vinculado a tu cuenta.'}</p></div><span className={`simulator-tag system-${supabaseStatus}`}><Fingerprint size={14} />{supabaseStatus === 'ready' ? 'SERVICIO DISPONIBLE' : 'SERVICIO NO DISPONIBLE'}</span></section>
          {initialGatewayRequest.bound && <section className="gateway-request-card" aria-label="Detalles de la solicitud">
            {gatewayPreviewLoading ? <div className="gateway-preview-state"><span className="loading-spinner" /><span>Verificando la aplicación y sus permisos…</span></div>
              : gatewayPreviewError ? <div className="gateway-preview-state gateway-preview-error"><ShieldAlert size={18} /><div><strong>Solicitud no verificada</strong><span>{gatewayPreviewError}</span></div></div>
                : gatewayPreview && <>
                  <div className="gateway-request-heading">
                    <span className={`gateway-app-mark app-mark-${gatewayPreview.app.color}`}>{requestingAppLogo ? <img src={requestingAppLogo} alt="" /> : gatewayPreview.app.initials}</span>
                    <div className="gateway-app-copy"><span className="gateway-verified-label"><ShieldCheck size={12} />SOLICITUD VERIFICADA</span><h2>{gatewayPreview.app.name}</h2><p>Quiere iniciar sesión · {gatewayPreview.service.name}</p></div>
                    <span className="gateway-request-badge"><LockKeyhole size={13} />PlacetaID</span>
                  </div>
                  <details className="gateway-request-details">
                    <summary><ShieldCheck size={14} /><span>Revisar datos, permisos y destino</span><ChevronDown size={14} /></summary>
                    <div className="gateway-request-grid">
                    <div className="gateway-request-section"><span className="gateway-section-label">SERVICIO SOLICITADO</span><strong>{gatewayPreview.service.name}</strong><p>{gatewayPreview.service.description || 'La aplicación ha solicitado identificarte para este servicio.'}</p></div>
                    <div className="gateway-request-section"><span className="gateway-section-label">REQUISITOS DE ACCESO</span><ul className="gateway-requirements">
                      <li><Check size={13} />Cuenta PlacetaID activa</li>
                      {gatewayPreview.requirements.minAge > 0 && <li><Check size={13} />Edad mínima: {gatewayPreview.requirements.minAge} años</li>}
                      {gatewayPreview.requirements.allowedRoles.length > 0 && <li><Check size={13} />Tipo de cuenta: {gatewayPreview.requirements.allowedRoles.map((role) => roleLabels[role] || role).join(', ')}</li>}
                      <li><Check size={13} />Confirmación desde un método vinculado</li>
                    </ul></div>
                    <div className="gateway-request-section"><span className="gateway-section-label">DATOS QUE RECIBIRÁ</span><ul className="gateway-disclosure-list">
                      {gatewayPreview.disclosure.base.map((field) => <li key={field}><Check size={13} />{gatewayClaimLabel(field)}</li>)}
                      {gatewayPreview.disclosure.optional.map((field) => <li key={field}><LockKeyhole size={13} />{protectedFieldLabel(field)}<small>Solo con tu permiso</small></li>)}
                      {gatewayPreview.disclosure.unavailable.map((field) => <li key={field} className="gateway-unavailable-field"><X size={13} />{protectedFieldLabel(field)}<small>No disponible; no se enviará</small></li>)}
                    </ul><p className="gateway-data-footnote">No se comparten tu contraseña ni tus códigos de autenticación. Los datos protegidos requieren tu autorización expresa.</p></div>
                    <div className="gateway-request-section gateway-destination"><span className="gateway-section-label">DESTINO DE LA RESPUESTA</span><strong>{new URL(gatewayPreview.destination).host}</strong><code>{new URL(gatewayPreview.destination).pathname}</code><span>La respuesta de acceso volverá a esta dirección registrada.</span></div>
                    </div>
                  </details>
                </>}
          </section>}
          <div className="gateway-layout">
            <section className="gateway-flow-panel">
              <div className="gateway-wordmark-row"><h1 className="gateway-wordmark">PlacetaID</h1></div>
              <p className="gateway-tagline">{initialGatewayRequest.bound ? `Acceso seguro a ${gatewayPreview?.app.name || 'tu aplicación'}` : 'Una identidad, acceso seguro'}</p>
              <ol className="gateway-progress" aria-label="Fases de autenticación">
                {[
                  { key: 'account', label: 'Cuenta', active: gatewayStage === 'entry', done: gatewayStage !== 'entry' },
                  { key: 'verify', label: 'Verificación', active: gatewayStage === 'detected' || gatewayStage === 'password', done: gatewayStage === 'legal' || gatewayStage === 'consent' || gatewayStage === 'authenticated' },
                  { key: 'review', label: 'Revisión', active: gatewayStage === 'legal' || gatewayStage === 'consent', done: gatewayStage === 'authenticated' },
                ].map((step, index) => <li className={`${step.active ? 'is-current' : ''} ${step.done ? 'is-done' : ''}`} key={step.key}><span>{step.done ? <Check size={12} /> : index + 1}</span><small>{step.label}</small></li>)}
              </ol>
              <div className="gateway-step-heading"><span className={`step-number ${gatewayStage !== 'entry' ? 'step-complete' : ''}`}>{gatewayStage === 'entry' ? '01' : <Check size={13} />}</span><div><h2>{gatewayStage === 'entry' ? 'Identifica tu cuenta' : gatewayStage === 'detected' || gatewayStage === 'password' ? 'Confirma que eres tú' : gatewayStage === 'legal' || gatewayStage === 'consent' ? 'Revisa y autoriza' : 'Acceso confirmado'}</h2><p>{gatewayStage === 'entry' ? 'Introduce el DIP asociado a PlacetaID.' : gatewayStage === 'detected' ? 'Aprueba la solicitud con un método ya vinculado.' : gatewayStage === 'password' ? 'Introduce tu contraseña de PlacetaID para verificar la cuenta.' : gatewayStage === 'legal' ? 'Lee los documentos antes de continuar.' : gatewayStage === 'consent' ? 'Tú decides qué datos protegidos compartir.' : 'Has iniciado sesión de forma segura.'}</p></div></div>
              {gatewayStage === 'entry' && <form className="gateway-form" onSubmit={submitGatewayDip}>
                <label className="field-label" htmlFor="gateway-dip">DIP</label>
                <input id="gateway-dip" className="gateway-dip-input" value={gatewayDip} onChange={(event) => { setGatewayDip(event.target.value.toUpperCase()); setGatewayError(''); setGatewayNeedsEnrollment(false) }} placeholder="12345678Z" maxLength={11} autoComplete="username" required />
                <p className="gateway-input-note"><LockKeyhole size={13} />El DIP solo localiza la identidad; no permite iniciar sesión por sí solo.</p>
                {gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}
                {gatewayNeedsEnrollment && <div className="gateway-enrollment-help">
                  <p>Abre PlacetaID Móvil e inicia sesión con el DIP y la contraseña de tu cuenta PL26. Desde la app, vincula este dispositivo; después vuelve aquí para iniciar sesión.</p>
                  <a className="button-quiet" href="https://play.google.com/store/search?q=PlacetaID&c=apps" target="_blank" rel="noreferrer">Buscar PlacetaID en Google Play</a>
                </div>}
                <button className="button-primary gateway-continue" type="submit" disabled={gatewayBusy || gatewayIdentifyRetrySeconds > 0 || supabaseStatus !== 'ready' || (initialGatewayRequest.bound && (gatewayPreviewLoading || !gatewayPreview))}>{gatewayBusy ? 'Buscando identidad…' : gatewayIdentifyRetrySeconds > 0 ? `Espera ${Math.floor(gatewayIdentifyRetrySeconds / 60)}:${String(gatewayIdentifyRetrySeconds % 60).padStart(2, '0')}` : 'Continuar'} <ArrowRight size={15} /></button>
              </form>}
              {gatewayStage === 'detected' && <div className="method-detection">
                <div className="gateway-identified"><span className="user-avatar user-avatar-large"><Fingerprint size={20} /></span><div><strong>Cuenta localizada</strong><small>Datos personales ocultos hasta completar la autenticación</small></div><button className="text-action" onClick={() => { setGatewayStage('entry'); setGatewayRequestId(''); setGatewayConfirmationCode(''); setGatewayMethod(null); setGatewayError(''); setGatewayNeedsEnrollment(false) }}>Cambiar DIP</button></div>
                <div className="gateway-step-heading"><span className="step-number">02</span><div><h2>Confirma tu identidad</h2><p>{gatewayMethod === 'mobile' ? 'Aprueba la solicitud en PlacetaID móvil.' : gatewayMethod === 'desktop' ? 'Aprueba la solicitud en PlacetaID Desktop.' : 'Introduce el código actual de tu Autentificador.'}</p></div></div>
                <div className="priority-method priority-method-selected"><span className="priority-method-icon">{gatewayMethod === 'mobile' ? <Smartphone size={16} /> : gatewayMethod === 'desktop' ? <Monitor size={16} /> : <KeyRound size={16} />}</span><span><strong>{gatewayMethod === 'mobile' ? 'PlacetaID móvil' : gatewayMethod === 'desktop' ? 'PlacetaID Desktop' : 'Autentificador'}</strong><small>Solicitud protegida y temporal</small></span><span className="priority-method-state">VINCULADO</span></div>
                {(gatewayMethod === 'mobile' || gatewayMethod === 'desktop') && gatewayConfirmationCode && <div className="gateway-confirmation-code" role="status" aria-live="polite"><div><span>CÓDIGO DE CONFIRMACIÓN</span><strong>{gatewayConfirmationCode}</strong></div><p>Abre la solicitud en PlacetaID {gatewayMethod === 'mobile' ? 'Móvil' : 'Desktop'} y comprueba que aparece este mismo código antes de aprobar. Si no coincide, recházala.</p></div>}
                {gatewayMethod === 'authenticator' && <><label className="field-label gateway-otp-label" htmlFor="gateway-otp">Código de seis cifras</label><input className="gateway-otp-input" id="gateway-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={gatewayOtp} onChange={(event) => { setGatewayOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setGatewayError('') }} placeholder="000000" /></>}
                {gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}
                <button className="button-primary gateway-continue" disabled={gatewayBusy} onClick={confirmGatewayIdentity}>{gatewayBusy ? 'Esperando confirmación segura…' : gatewayMethod === 'authenticator' ? 'Verificar código' : 'Esperar aprobación del dispositivo'} <ArrowRight size={15} /></button>
                {passwordLoginEnabled && <button className="gateway-password-link" type="button" onClick={() => { setGatewayPassword(''); setGatewayError(''); setGatewayStage('password') }}>Usar temporalmente mi contraseña de PlacetaID</button>}
              </div>}
              {gatewayStage === 'password' && passwordLoginEnabled && <form className="gateway-form gateway-password-form" onSubmit={submitGatewayPassword}>
                <div className="gateway-step-heading"><span className="step-number">02</span><div><h2>Confirma que eres tú</h2><p>Acceso temporal con la contraseña de tu cuenta PlacetaID.</p></div></div>
                <label className="field-label" htmlFor="gateway-password">Contraseña de PlacetaID</label>
                <input id="gateway-password" className="gateway-password-input" type="password" value={gatewayPassword} onChange={(event) => { setGatewayPassword(event.target.value); setGatewayError('') }} autoComplete="current-password" maxLength={256} required />
                <p className="gateway-input-note"><LockKeyhole size={13} />La contraseña solo se usa para esta comprobación; nunca se comparte con la aplicación solicitante.</p>
                {gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}
                <button className="button-primary gateway-continue" type="submit" disabled={gatewayBusy || !gatewayPassword}>{gatewayBusy ? 'Verificando…' : 'Confirmar identidad'} <ArrowRight size={15} /></button>
                {gatewayRequestId && <button className="gateway-password-link" type="button" onClick={() => { setGatewayStage('detected'); setGatewayPassword(''); setGatewayError('') }}>Volver a PlacetaID {gatewayMethod === 'desktop' ? 'Desktop' : gatewayMethod === 'authenticator' ? 'Autentificador' : 'Móvil'}</button>}
                <small className="gateway-password-temporary-note">Método temporal mientras terminas de vincular PlacetaID Móvil o Desktop.</small>
              </form>}
              {gatewayStage === 'legal' && <div className="legal-consent-step">
                <div className="gateway-step-heading"><span className="step-number">03</span><div><h2>Revisa los documentos</h2><p>La aceptación se registrará en Supabase.</p></div></div>
                <div className="legal-document-links"><button onClick={() => setLegalDocument('terms')}><ShieldCheck size={16} /><span><strong>Términos y condiciones</strong><small>Uso de la identidad y acceso a servicios</small></span><ArrowRight size={14} /></button><button onClick={() => setLegalDocument('privacy')}><LockKeyhole size={16} /><span><strong>Política de privacidad</strong><small>Datos utilizados y control del titular</small></span><ArrowRight size={14} /></button></div>
                <label className="legal-accept-option"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span className="custom-check"><Check size={11} /></span><span>He leído y acepto los <button type="button" className="inline-legal-link" onClick={() => setLegalDocument('terms')}>términos y condiciones</button>.</span></label>
                <label className="legal-accept-option"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span className="custom-check"><Check size={11} /></span><span>He leído la <button type="button" className="inline-legal-link" onClick={() => setLegalDocument('privacy')}>política de privacidad</button>.</span></label>
                {gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}
                <div className="legal-step-actions"><button className="button-quiet" onClick={rejectLegalDocuments}>No acepto</button><button className="button-primary" disabled={!termsAccepted || !privacyAccepted || gatewayBusy} onClick={acceptLegalDocuments}>{gatewayBusy ? 'Guardando…' : 'Aceptar y continuar'} <ArrowRight size={14} /></button></div>
                <small className="legal-version-note">Documentos v27 · {LEGAL_VERSION}</small>
              </div>}
              {gatewayStage === 'consent' && <div className="legal-consent-step">
                <div className="gateway-step-heading"><span className="step-number">04</span><div><h2>Permisos de datos</h2><p>{gatewayAppName || 'La aplicación'} solicita acceso a estos datos protegidos.</p></div></div>
                {gatewayConsentFields.map((field) => <div className="gateway-consent-row" key={field}><span className="consent-field-icon">{field === 'dip' ? <Fingerprint size={15} /> : field === 'email' ? <Mail size={15} /> : field === 'phone' ? <Phone size={15} /> : field === 'photo' ? <ImageIcon size={15} /> : <BadgeCheck size={15} />}</span><div><strong>{protectedFieldLabel(field)}</strong><small>{field === 'dip' ? `El DIP permite a ${gatewayAppName || 'esta aplicación'} identificarte. Solo se compartirá si lo autorizas expresamente.` : 'El permiso es específico para esta aplicación y se puede revocar.'}</small></div><div className="gateway-consent-actions"><button className="consent-revoke-button" disabled={gatewayBusy} onClick={() => void decideGatewayConsent(field, 'denied')}>No permitir</button><button className="consent-review-button" disabled={gatewayBusy} onClick={() => void decideGatewayConsent(field, 'granted')}>Permitir</button></div></div>)}
                {gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}
              </div>}
              {gatewayStage === 'authenticated' && <div className="gateway-authenticated"><span className="gateway-auth-icon"><ShieldCheck size={18} /></span><div><strong>Identidad autenticada</strong><small>{gatewayUser ? `${gatewayUser.name} ${gatewayUser.surname} · ${gatewayUser.placeid}` : 'Acceso confirmado por PlacetaID'}</small></div></div>}
            </section>
            <section className="gateway-policy-panel">
              <div className="gateway-step-heading"><span className={`step-number ${gatewayStage === 'authenticated' ? 'step-complete' : ''}`}>{gatewayStage === 'authenticated' ? <Check size={13} /> : '02'}</span><div><h2>{gatewayStage === 'authenticated' ? 'Acceso confirmado' : 'Cómo funciona la confirmación'}</h2><p>{gatewayAppName ? `${gatewayAppName} · ${gatewayServiceName}` : 'Protección de tu cuenta PlacetaID'}</p></div></div>
              <div className="gateway-steps-list">
                <div className={gatewayStage !== 'entry' ? 'gateway-step-done' : 'gateway-step-current'}><span>{gatewayStage !== 'entry' ? <Check size={12} /> : '1'}</span><div><strong>Localizamos tu cuenta</strong><small>El DIP no es una contraseña ni se envía a la aplicación solicitante.</small></div></div>
                <div className={gatewayStage === 'legal' || gatewayStage === 'consent' || gatewayStage === 'authenticated' ? 'gateway-step-done' : gatewayStage === 'detected' ? 'gateway-step-current' : ''}><span>{gatewayStage === 'legal' || gatewayStage === 'consent' || gatewayStage === 'authenticated' ? <Check size={12} /> : '2'}</span><div><strong>Confirmas que eres tú</strong><small>Móvil, PlacetaID Desktop o un Autentificador compatible vinculado.</small></div></div>
                <div className={gatewayStage === 'authenticated' ? 'gateway-step-done' : gatewayStage === 'legal' || gatewayStage === 'consent' ? 'gateway-step-current' : ''}><span>{gatewayStage === 'authenticated' ? <Check size={12} /> : '3'}</span><div><strong>Revisas permisos y condiciones</strong><small>Los datos protegidos requieren tu permiso explícito.</small></div></div>
                <div className={gatewayStage === 'authenticated' ? 'gateway-step-done' : ''}><span>{gatewayStage === 'authenticated' ? <Check size={12} /> : '4'}</span><div><strong>Vuelves a la aplicación</strong><small>La respuesta se entrega solo a la dirección registrada que aparece arriba.</small></div></div>
              </div>
              <div className="gateway-compatibility"><div className="gateway-compatibility-heading"><ShieldCheck size={15} /><strong>Métodos compatibles</strong></div><ul>
                <li><Smartphone size={14} /><span><strong>PlacetaID Móvil</strong><small>Revisa la solicitud pendiente y compara el código antes de aprobar.</small></span></li>
                <li><Monitor size={14} /><span><strong>PlacetaID Desktop</strong><small>Confirma desde tu equipo previamente vinculado.</small></span></li>
                <li><KeyRound size={14} /><span><strong>Autentificador anterior</strong><small>Funciona si su secreto verificado ya se migró y vinculó a v27.</small></span></li>
              </ul><p>Recomendado: migra tus métodos antiguos a PlacetaID v27 para mantenerlos disponibles y protegidos.</p></div>
              {gatewayStage === 'authenticated' && <div className="gateway-response"><div className="payload-heading"><div><h3>Datos efectivamente compartidos</h3><p>Respuesta emitida por PlacetaID</p></div><span className="json-chip">JSON</span></div><pre className="payload-code">{JSON.stringify(gatewayClaims || { login_correct: true }, null, 2)}</pre></div>}
            </section>
          </div>
          {gatewayError && gatewayStage !== 'entry' && gatewayStage !== 'detected' && <p className="gateway-error" role="alert">{gatewayError}</p>}
          <div className="gateway-privacy-footer"><LockKeyhole size={14} /><span>El DIP no autentica por sí solo. Las credenciales y decisiones se verifican y registran en Supabase.</span></div>
        </div>}

        {view === 'simulator' && <div className="page-content simulator-page">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />COMPROBACIÓN DE POLÍTICAS</div><h1>Simulador de acceso</h1><p>Comprueba qué sucede antes de conceder una integración a los usuarios.</p></div><span className="simulator-tag"><Code2 size={14} />SIMULACIÓN LOCAL</span></section>
          <div className="simulator-layout"><section className="simulator-form"><div className="sim-section-title"><span className="step-number">01</span><div><h2>Solicitud de acceso</h2><p>Configura una identidad y un servicio de prueba</p></div></div>
            <label className="field-label" htmlFor="sim-user">Identidad de prueba</label><div className="select-control"><select id="sim-user" value={simUserId} onChange={(event) => { const user = users.find((item) => item.id === event.target.value); setSimUserId(event.target.value); if (user) { setSimAge(calculateAge(user.birthDate)); setSimRole(user.role) } }}>{users.map((user) => <option value={user.id} key={user.id}>{user.name} {user.surname} · {user.placeid}</option>)}</select><ChevronDown size={14} /></div>
            <label className="field-label" htmlFor="sim-app">Aplicación</label><div className="select-control"><select id="sim-app" value={simAppId} onChange={(event) => changeSimApp(event.target.value)}>{integrations.map((item) => <option value={item.id} key={item.id}>{item.name} · {statusLabel(item.status)}</option>)}</select><ChevronDown size={14} /></div>
            <label className="field-label" htmlFor="sim-service">Servicio solicitado</label><div className="select-control"><select id="sim-service" value={simServiceId} onChange={(event) => setSimServiceId(event.target.value)}>{(simApp?.services ?? []).map((service) => <option value={service.id} key={service.id}>{service.name}{service.enabled ? '' : ' · Desactivado'}</option>)}</select><ChevronDown size={14} /></div>
            <div className="sim-fields-row"><div><label className="field-label" htmlFor="sim-age">Edad</label><div className="select-control"><select id="sim-age" value={simAge} onChange={(event) => setSimAge(Number(event.target.value))}><option value={12}>12 años</option><option value={15}>15 años</option><option value={16}>16 años</option><option value={17}>17 años</option><option value={18}>18 años</option><option value={25}>25 años</option></select><ChevronDown size={14} /></div></div><div><label className="field-label" htmlFor="sim-role">Tipo de usuario</label><div className="select-control"><select id="sim-role" value={simRole} onChange={(event) => setSimRole(event.target.value as Role)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select><ChevronDown size={14} /></div></div></div>
            <div className="identity-preview"><span className="identity-preview-icon"><Fingerprint size={18} /></span><div><strong>{simIdentity?.name} {simIdentity?.surname}</strong><small>{simIdentity?.placeid} · {simAge} años</small></div><span className="verified-label"><BadgeCheck size={13} />{simIdentity?.identityVerified ? 'Verificada' : 'Pendiente'}</span></div>
            <div className="sim-privacy-note"><LockKeyhole size={14} /><span>La fecha de nacimiento exacta no se comparte. PlacetaID solo calcula los indicadores autorizados.</span></div>
          </section>

          <section className="simulator-result"><div className="result-topline"><span className="step-number">02</span><span className="result-label">DECISIÓN DE PLACETAID</span><span className="result-live"><i />EN TIEMPO REAL</span></div>
            <div className={`decision-banner ${simReason ? 'decision-denied' : 'decision-allowed'}`}><span className="decision-icon">{simReason ? <ShieldAlert size={21} /> : <ShieldCheck size={21} />}</span><div><strong>{simReason ? 'Acceso denegado' : 'Acceso concedido'}</strong><small>{simReason || 'La identidad cumple las condiciones de esta integración.'}</small></div></div>
            <div className="decision-checks"><div className="decision-check-heading"><h3>Reglas evaluadas</h3><span>{simReason ? 'Revisar restricciones' : 'Todas las condiciones se cumplen'}</span></div>
              {[{ label: 'Cuenta habilitada', ok: Boolean(simIdentity && !['pending', 'suspended', 'closed'].includes(simIdentity.status)) }, { label: 'Aplicación autorizada', ok: simApp?.status === 'authorized' && simIdentity?.appOverrides[simApp.id] !== 'deny' }, { label: 'Servicio disponible', ok: Boolean(simService?.enabled) }, { label: 'Tipo de usuario permitido', ok: Boolean(simApp?.roles.includes(simRole) && (simService?.roles === null ? simApp.roles.includes(simRole) : simService?.roles.includes(simRole))) }, { label: `Edad mínima (${Math.max(simApp?.minAge ?? 0, simService?.minAge ?? 0)}+)`, ok: simAge >= Math.max(simApp?.minAge ?? 0, simService?.minAge ?? 0) }].map((rule) => <div className="decision-check" key={rule.label}><span className={rule.ok ? 'check-state check-ok' : 'check-state check-no'}>{rule.ok ? <Check size={12} /> : <X size={12} />}</span><span>{rule.label}</span><span className={rule.ok ? 'check-word check-word-ok' : 'check-word check-word-no'}>{rule.ok ? 'Cumple' : 'No cumple'}</span></div>)}
            </div>
            <div className="payload-panel"><div className="payload-heading"><div><h3>Datos para la aplicación</h3><p>Solo permisos autorizados por Administración</p></div><span className="json-chip">JSON</span></div><pre className="payload-code">{JSON.stringify(simApp && !simReason ? {
              login_correct: true,
              over_16: simAge >= 16,
              over_18: simAge >= 18,
              name: simIdentity?.name,
              surname: simIdentity?.surname,
              ...(simApp.scopes.dip && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'dip' && permission.status === 'granted') ? { dip: simIdentity.dip } : {}),
              ...(simApp.scopes.email && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'email' && permission.status === 'granted') ? { email: simIdentity.email } : {}),
              ...(simApp.scopes.phone && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'phone' && permission.status === 'granted') ? { phone: simIdentity.phone } : {}),
              ...(simApp.scopes.photo && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'photo' && permission.status === 'granted') ? { profile_photo: `/demo/${simIdentity.id}/avatar` } : {}),
              ...(simApp.scopes.identityVerified && simIdentity?.identityVerified && simIdentity.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'identityVerified' && permission.status === 'granted') ? { identity_verified: true } : {}),
            } : { login_correct: false }, null, 2)}</pre><div className="payload-footnote"><Fingerprint size={13} />El documento de identidad nunca se incluye en la respuesta.</div></div>
          </section></div>
        </div>}

        {view === 'activity' && <div className="page-content activity-page"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />TRAZABILIDAD</div><h1>Registro de actividad</h1><p>Historial local de cambios realizados en esta vista previa.</p></div><span className="local-only-tag"><Activity size={14} />REGISTRO LOCAL</span></section><section className="activity-panel"><div className="activity-panel-heading"><div><h2>Últimos cambios</h2><p>Las acciones quedan vinculadas a la integración afectada.</p></div><span className="total-chip">{audit.length} eventos</span></div>{audit.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-icon"><ClipboardCheck size={16} /></span><div><strong>{entry.action}</strong><small>{entry.subject}</small></div><time>{entry.time}</time></div>)}</section></div>}

        {isPublicView ? <footer className="public-footer"><span>PlacetaID v27.0 <i>·</i> Plan 2027 · Ámbito 25</span><span>Identidad digital segura</span></footer> : <footer className="app-footer"><span><span className="footer-mark"><Fingerprint size={13} /></span>PlacetaID v27.0 <span className="footer-dot">·</span> Gobierno de identidad</span><span>Panel de Administración <span className="footer-dot">·</span> Vista previa</span></footer>}
      </main>

      {newAppOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingApp) setNewAppOpen(false) }}><form className="integration-modal" onSubmit={addIntegration}><div className="modal-topline"><span className="modal-icon"><Plus size={18} /></span><button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setNewAppOpen(false)}><X size={17} /></button></div><h2>{newAppCredential ? 'Aplicación registrada' : 'Nueva integración'}</h2><p>{newAppCredential ? 'Las credenciales se muestran ahora una sola vez. Guárdalas en el backend seguro de tu aplicación.' : 'La solicitud se guardará en Supabase y recibirá un client_id real.'}</p>{newAppCredential ? <div className="created-credentials"><label className="field-label" htmlFor="created-client-id">Client ID</label><div className="credential-value"><code id="created-client-id">{newAppCredential.clientId}</code><button type="button" className="button-quiet" onClick={() => void copyCredential(newAppCredential.clientId)}>Copiar</button></div><label className="field-label" htmlFor="created-client-secret">Client secret · una sola vez</label><div className="credential-value"><code id="created-client-secret">{newAppCredential.clientSecret}</code><button type="button" className="button-quiet" onClick={() => void copyCredential(newAppCredential.clientSecret)}>Copiar</button></div>{newAppError && <p className="gateway-error" role="alert">{newAppError} Puedes cargar el logo desde la ficha de la aplicación.</p>}<div className="modal-info"><ShieldAlert size={15} /><span>No lo incluyas en JavaScript del navegador, repositorios ni URLs. Guárdalo como secreto del servidor. El acceso seguirá pendiente hasta que Administración lo autorice.</span></div><div className="modal-actions"><button className="button-primary" type="button" onClick={() => { setNewAppOpen(false); setNewAppCredential(null); setNewAppName(''); setNewAppDescription(''); setNewAppRedirectUri(''); setNewAppLogo(null); setNewAppError('') }}>He guardado las credenciales</button></div></div> : <><label className="field-label" htmlFor="new-app-name">Nombre de la aplicación</label><input className="modal-input" id="new-app-name" autoFocus maxLength={100} value={newAppName} onChange={(event) => setNewAppName(event.target.value)} placeholder="Ej. Portal de servicios" required /><label className="field-label" htmlFor="new-app-category">Categoría</label><input className="modal-input" id="new-app-category" maxLength={80} value={newAppCategory} onChange={(event) => setNewAppCategory(event.target.value)} placeholder="Ecosistema" /><label className="field-label" htmlFor="new-app-description">Descripción</label><input className="modal-input" id="new-app-description" maxLength={500} value={newAppDescription} onChange={(event) => setNewAppDescription(event.target.value)} placeholder="Qué ofrece esta aplicación" /><label className="app-logo-upload"><span>{newAppLogo ? <ImageIcon size={18} /> : <Plus size={18} />}</span><span><strong>{newAppLogo ? newAppLogo.name : 'Añadir logo de la aplicación'}</strong><small>PNG, JPEG o WebP · máximo 1 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setNewAppLogo(event.target.files?.[0] ?? null); event.currentTarget.value = '' }} /></label><label className="field-label" htmlFor="new-app-redirect">Redirect URI</label><input className="modal-input" id="new-app-redirect" type="url" value={newAppRedirectUri} onChange={(event) => setNewAppRedirectUri(event.target.value)} placeholder="https://app.ejemplo.org/placetaid/callback" required /><small className="field-help">Debe coincidir exactamente con el callback de tu aplicación. HTTPS obligatorio, salvo localhost en desarrollo.</small>{newAppError && <p className="gateway-error" role="alert">{newAppError}</p>}<div className="modal-info"><ShieldAlert size={15} /><span>Se crea un servicio general y la integración queda pendiente; solo podrá iniciar login después de autorizarla en el catálogo.</span></div><div className="modal-actions"><button className="button-quiet" type="button" onClick={() => setNewAppOpen(false)} disabled={creatingApp}>Cancelar</button><button className="button-primary" type="submit" disabled={creatingApp || !adminToken}><Plus size={15} />{creatingApp ? 'Creando en Supabase…' : 'Crear aplicación'}</button></div></>}</form></div>}
      {secretRotateTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !rotatingSecret) setSecretRotateTarget(null) }}><section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="rotate-secret-title"><div className="modal-topline"><span className="modal-icon"><KeyRound size={18} /></span><button type="button" className="icon-button" aria-label="Cerrar" disabled={rotatingSecret} onClick={() => setSecretRotateTarget(null)}><X size={17} /></button></div><h2 id="rotate-secret-title">Regenerar secreto</h2><p>Se creará una clave nueva para <strong>{secretRotateTarget.name}</strong>. El secreto actual dejará de funcionar inmediatamente; tendrás que actualizarlo en el servidor de la aplicación.</p>{rotateSecretError && <p className="gateway-error" role="alert">{rotateSecretError}</p>}<div className="modal-actions"><button className="button-quiet" type="button" disabled={rotatingSecret} onClick={() => setSecretRotateTarget(null)}>Cancelar</button><button className="button-primary" type="button" disabled={rotatingSecret || !adminToken} onClick={() => void rotateApplicationSecret()}><KeyRound size={14} />{rotatingSecret ? 'Regenerando…' : 'Regenerar secreto'}</button></div></section></div>}
      {rotatedCredential && <div className="modal-backdrop" role="presentation"><section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="rotated-secret-title"><div className="modal-topline"><span className="modal-icon"><KeyRound size={18} /></span><button type="button" className="icon-button" aria-label="Cerrar y borrar el secreto de la pantalla" onClick={() => setRotatedCredential(null)}><X size={17} /></button></div><h2 id="rotated-secret-title">Secreto nuevo generado</h2><p>Guárdalo ahora en las variables de entorno del servidor de <strong>{rotatedCredential.appName}</strong>. PlacetaID no podrá volver a mostrarlo.</p><div className="created-credentials"><label className="field-label" htmlFor="rotated-client-id">Client ID</label><div className="credential-value"><code id="rotated-client-id">{rotatedCredential.clientId}</code><button type="button" className="button-quiet" onClick={() => void copyCredential(rotatedCredential.clientId)}>Copiar</button></div><label className="field-label" htmlFor="rotated-client-secret">Client secret · una sola vez</label><div className="credential-value"><code id="rotated-client-secret">{rotatedCredential.clientSecret}</code><button type="button" className="button-quiet" onClick={() => void copyCredential(rotatedCredential.clientSecret)}>Copiar</button></div><div className="modal-info"><ShieldAlert size={15} /><span>Guarda este secreto como <code>PLACETAID_CLIENT_SECRET</code> en el backend. No lo pongas en código del navegador, repositorios ni URLs.</span></div>{rotatedCredential.auditWarning && <p className="gateway-error" role="alert">El secreto se regeneró, pero no se pudo guardar el evento de auditoría. Guarda el valor nuevo ahora.</p>}<div className="modal-actions"><button className="button-primary" type="button" onClick={() => setRotatedCredential(null)}>He guardado el secreto</button></div></div></section></div>}
      {consentPrompt && <div className="modal-backdrop consent-modal-backdrop" role="presentation"><section className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title"><div className="consent-modal-top"><span className="consent-modal-icon"><LockKeyhole size={18} /></span><button className="icon-button" aria-label="Cerrar solicitud" onClick={() => setConsentPrompt(null)}><X size={16} /></button></div><div className="eyebrow"><span className="eyebrow-line" />SOLICITUD DE DATO PROTEGIDO</div><h2 id="consent-modal-title">{integrations.find((app) => app.id === consentPrompt.appId)?.name ?? 'Esta aplicación'} quiere acceder a {protectedFieldLabel(consentPrompt.field).toLowerCase()}.</h2><p>Esta aplicación solicita permiso para utilizar este dato asociado a tu PlacetaID. La autorización solo se aplica a esta aplicación y puedes revocarla después.</p><div className="consent-modal-data"><span>{protectedFieldLabel(consentPrompt.field)}</span><span>Tu permiso, siempre revocable</span></div><div className="modal-actions"><button className="button-quiet" onClick={() => resolveConsentPrompt('denied')}>No permitir</button><button className="button-primary" onClick={() => resolveConsentPrompt('granted')}><Check size={14} />Permitir</button></div></section></div>}
      {passwordResetTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !adminPasswordSaving) setPasswordResetTarget(null) }}><form className="integration-modal admin-password-modal" onSubmit={submitAdminPassword}><div className="modal-topline"><span className="modal-icon"><KeyRound size={18} /></span><button type="button" className="icon-button" aria-label="Cerrar" disabled={adminPasswordSaving} onClick={() => setPasswordResetTarget(null)}><X size={17} /></button></div><h2>Cambiar contraseña</h2><p>Se actualizará la credencial de <strong>{passwordResetTarget.name} {passwordResetTarget.surname}</strong> en PlacetaID y, si existe, también en PL26. Las sesiones y los dispositivos activos se revocarán.</p><label className="field-label" htmlFor="admin-new-password">Nueva contraseña</label><input className="modal-input" id="admin-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={256} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required /><small className="field-help">Entre 8 y 256 caracteres, con al menos una letra y un número.</small><label className="field-label" htmlFor="admin-confirm-password">Confirmar contraseña</label><input className="modal-input" id="admin-confirm-password" type="password" autoComplete="new-password" maxLength={256} value={adminPasswordConfirmation} onChange={(event) => setAdminPasswordConfirmation(event.target.value)} required />{adminPasswordError && <p className="gateway-error" role="alert">{adminPasswordError}</p>}<div className="modal-actions"><button className="button-quiet" type="button" disabled={adminPasswordSaving} onClick={() => setPasswordResetTarget(null)}>Cancelar</button><button className="button-primary" type="submit" disabled={adminPasswordSaving || !adminToken}>{adminPasswordSaving ? 'Actualizando…' : 'Actualizar contraseña'}</button></div></form></div>}
      {legalDocument && <div className="modal-backdrop legal-document-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLegalDocument(null) }}><section className="legal-document-modal" role="dialog" aria-modal="true" aria-labelledby="legal-document-title"><div className="consent-modal-top"><span className="consent-modal-icon">{legalDocument === 'terms' ? <ShieldCheck size={18} /> : <LockKeyhole size={18} />}</span><button className="icon-button" aria-label="Cerrar documento" onClick={() => setLegalDocument(null)}><X size={16} /></button></div><span className="eyebrow">PLACETAID v27 · {LEGAL_VERSION}</span><h2 id="legal-document-title">{legalDocument === 'terms' ? 'Términos y condiciones' : 'Política de privacidad'}</h2>{legalDocument === 'terms' ? <div className="legal-document-copy"><h3>Servicio y autenticación</h3><p>PlacetaID localiza la cuenta con el DIP y confirma la identidad mediante un método de autenticación previamente vinculado. El DIP por sí solo no permite iniciar sesión. El acceso a cada aplicación depende de sus reglas, del estado de la cuenta y de la aprobación del titular.</p><h3>Información compartida</h3><p>Antes de confirmar una solicitud, PlacetaID identifica la aplicación y el servicio solicitante e informa de los datos que se transmitirán. Se incluyen el resultado de autenticación, indicadores de edad y nombre y apellidos. Los datos protegidos solo se transmiten cuando la aplicación está autorizada y el titular presta consentimiento específico. Las contraseñas, códigos temporales y tokens de dispositivo no se entregan a la aplicación solicitante.</p><h3>Uso responsable y seguridad</h3><p>El titular debe mantener bajo su control sus dispositivos y códigos de autenticación y comunicar cualquier pérdida. No debe compartir códigos ni intentar acceder a cuentas ajenas. PlacetaID puede suspender temporalmente una cuenta o integración ante riesgos de seguridad o incumplimientos; las decisiones de acceso y seguridad pueden registrarse para prevenir fraude y resolver incidencias.</p><h3>Permisos y finalización</h3><p>El titular puede rechazar una solicitud de acceso y revisar o revocar los permisos de datos protegidos desde «Mis permisos». La revocación evita que se incluyan esos datos en nuevas respuestas de PlacetaID; no elimina copias que la aplicación receptora ya hubiera obtenido, por lo que las solicitudes de supresión de esas copias deben dirigirse también a dicha aplicación.</p></div> : <div className="legal-document-copy"><h3>Responsable y finalidad</h3><p>Responsable: Grupo de La Placeta. PlacetaID trata los datos de identidad para localizar la cuenta solicitada, autenticar al titular, calcular los indicadores de edad necesarios y aplicar las reglas de acceso de la aplicación y el servicio identificados en pantalla.</p><h3>Datos tratados y destinatarios</h3><p>Se utilizan el DIP para localizar la cuenta, los datos necesarios para verificar el método de autenticación, el nombre y apellidos y los indicadores «mayor de 16» y «mayor de 18». La aplicación y el servicio indicados en cada solicitud reciben la respuesta de autenticación y esos datos básicos. El DIP, correo electrónico y estado de identidad verificada son datos protegidos: solo se envían si la aplicación está autorizada para solicitarlos y el titular los permite expresamente. El teléfono y la fotografía no se comparten en este flujo. Las contraseñas, códigos temporales y tokens de dispositivo no se entregan a la aplicación solicitante.</p><h3>Base, conservación y seguridad</h3><p>La autenticación se realiza para atender la solicitud iniciada por el titular y aplicar los controles de seguridad de la cuenta. El consentimiento es la base para compartir cada dato protegido. Los registros de autenticación y seguridad se conservan mientras sean necesarios para proteger el servicio, investigar incidencias y cumplir obligaciones aplicables; los permisos se mantienen hasta su revocación o el cierre de la cuenta. Se aplican controles de acceso, cifrado de secretos de autenticación y auditoría de operaciones sensibles.</p><h3>Derechos y contacto</h3><p>Puedes solicitar acceso, rectificación, supresión, limitación u oposición al tratamiento, y retirar un consentimiento desde «Mis permisos» sin afectar a los tratamientos anteriores. Para ejercer otros derechos, contacta con Administración de La Placeta a través de sus canales oficiales. También puedes reclamar ante la autoridad de protección de datos competente. La revocación en PlacetaID no borra los datos que la aplicación receptora ya haya recibido; solicita su supresión directamente a esa aplicación.</p></div>}<button className="button-primary legal-document-close" onClick={() => setLegalDocument(null)}>Cerrar documento</button></section></div>}
      {isPublicView && view !== 'gateway' && <button className="floating-plan-button" aria-haspopup="dialog" onClick={() => setPlanInfoOpen(true)}><span className="floating-plan-number">25</span><span><small>PLAN 2027</small><strong>Transformación digital</strong></span><ArrowRight size={15} /></button>}
      {planInfoOpen && <div className="plan-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlanInfoOpen(false) }}><section className="plan-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title"><div className="plan-dialog-top"><span>PLAN 2027 <i>·</i> ÁMBITO 25</span><button className="icon-button" aria-label="Cerrar detalle del Plan 2027" onClick={() => setPlanInfoOpen(false)}><X size={16} /></button></div><h2 id="plan-dialog-title">Fomento de la transformación digital</h2><p>Impulso de la modernización tecnológica de organizaciones, proyectos y servicios.</p><div className="plan-transition"><span>PlacetaID v27</span><strong>En transición desde 2026</strong></div><button className="button-primary" onClick={() => setPlanInfoOpen(false)}>Cerrar</button></section></div>}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </div>
  )
}

export default App
