import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
type ProtectedField = 'email' | 'phone' | 'photo' | 'identityVerified'
type UserStatus = 'active' | 'pending' | 'restricted' | 'suspended' | 'closed'
type ConsentStatus = 'pending' | 'granted' | 'denied' | 'revoked'
type GatewayStage = 'entry' | 'detected' | 'legal' | 'authenticated'
type LegalDocument = 'terms' | 'privacy'

const LEGAL_VERSION = 'v27.0-2026-10'

type Service = {
  id: string
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
    scopes: { email: true, phone: false, photo: false, identityVerified: true }, updated: 'Hoy, 10:24',
    services: [
      { id: 'general', name: 'Acceso general', description: 'Inicio de sesión en el portal', enabled: true, minAge: 0, roles: ['administrador', 'miembro', 'entidad'] },
      { id: 'cuentas', name: 'Consulta de cuentas', description: 'Posición y movimientos', enabled: true, minAge: 16, roles: ['administrador', 'miembro', 'entidad'] },
      { id: 'tarjetas', name: 'Tarjetas', description: 'Gestión de tarjetas de pago', enabled: true, minAge: 18, roles: ['administrador', 'miembro'] },
      { id: 'financiacion', name: 'Financiación', description: 'Solicitudes y contratos', enabled: false, minAge: 18, roles: ['administrador', 'miembro', 'entidad'] },
    ],
  },
  {
    id: 'rsp', clientId: 'eaf341d5a71b9a3bfc01d0fc8c31ea01', name: 'RSP', category: 'Administración', initials: 'RS', color: 'coral', status: 'authorized', minAge: 16,
    roles: ['administrador', 'miembro'], scopes: { email: true, phone: false, photo: false, identityVerified: true }, updated: 'Ayer, 16:08',
    services: [
      { id: 'panel', name: 'Panel de servicios', description: 'Acceso al panel de administración', enabled: true, minAge: 16, roles: ['administrador'] },
      { id: 'expedientes', name: 'Expedientes', description: 'Consulta de expedientes propios', enabled: true, minAge: 16, roles: ['administrador', 'miembro'] },
      { id: 'firma', name: 'Firma electrónica', description: 'Validación de identidad para firma', enabled: true, minAge: 18, roles: ['administrador', 'miembro'] },
    ],
  },
  {
    id: 'joven', clientId: 'placetajoven-web', name: 'Placeta Joven', category: 'Comunidad', initials: 'PJ', color: 'orange', status: 'authorized', minAge: 16,
    roles: ['miembro'], scopes: { email: true, phone: false, photo: true, identityVerified: false }, updated: '28 oct 2026',
    services: [
      { id: 'ventajas', name: 'Ventajas', description: 'Catálogo de descuentos', enabled: true, minAge: 16, roles: ['miembro'] },
      { id: 'eventos', name: 'Eventos', description: 'Inscripción a actividades', enabled: true, minAge: 16, roles: ['miembro'] },
      { id: 'suscripcion', name: 'Suscripción', description: 'Gestión del plan joven', enabled: true, minAge: 18, roles: ['miembro'] },
    ],
  },
  {
    id: 'crm', clientId: 'ccb611655030bdadf7218418dc195dcb', name: 'CRM Grupo Placeta', category: 'Administración', initials: 'CR', color: 'blue', status: 'authorized', minAge: 18,
    roles: ['administrador', 'entidad'], scopes: { email: true, phone: true, photo: false, identityVerified: true }, updated: '24 oct 2026',
    services: [
      { id: 'contactos', name: 'Contactos', description: 'Gestión de contactos', enabled: true, minAge: 18, roles: ['administrador', 'entidad'] },
      { id: 'informes', name: 'Informes', description: 'Informes internos', enabled: true, minAge: 18, roles: ['administrador'] },
    ],
  },
  {
    id: 'voley', clientId: 'voley-club', name: 'Voley Club La Placeta', category: 'Deporte', initials: 'VC', color: 'pink', status: 'authorized', minAge: 0,
    roles: ['miembro', 'visitante'], scopes: { email: false, phone: false, photo: false, identityVerified: false }, updated: '20 oct 2026',
    services: [
      { id: 'area-jugador', name: 'Área del jugador', description: 'Perfil y calendario deportivo', enabled: true, minAge: 0, roles: ['miembro', 'visitante'] },
      { id: 'competicion', name: 'Competición', description: 'Inscripción a competiciones', enabled: true, minAge: 16, roles: ['miembro'] },
    ],
  },
  {
    id: 'bop', clientId: 'bop-web', name: 'Boletín Oficial (BOP)', category: 'Publicación', initials: 'BO', color: 'slate', status: 'pending', minAge: 0,
    roles: ['administrador', 'miembro'], scopes: { email: false, phone: false, photo: false, identityVerified: false }, updated: 'Solicitud · 19 oct 2026',
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
  const appParameter = params.get('app') || clientId
  const app = initialIntegrations.find((item) => item.id === appParameter || item.clientId === appParameter)
  const serviceParameter = params.get('service') || params.get('service_key') || ''
  const service = app?.services.find((item) => item.id === serviceParameter || item.name.toLowerCase() === serviceParameter.toLowerCase())
  const redirectUri = params.get('redirect_uri') || ''
  const redirectAllowed = !clientId || Boolean(app?.redirectUris?.includes(redirectUri))
  return {
    appId: app?.id ?? 'joven',
    serviceId: service?.id ?? app?.services[0]?.id ?? 'ventajas',
    bound: Boolean(clientId || params.get('app')),
    valid: Boolean(clientId) && Boolean(app) && Boolean(redirectUri) && redirectAllowed,
    redirectUri,
    state: params.get('state') || '',
    appName: app?.name ?? '',
    serviceName: service?.name ?? '',
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
  return { email: 'Correo electrónico', phone: 'Número de teléfono', photo: 'Fotografía de perfil', identityVerified: 'Identidad verificada' }[field]
}

function calculateAge(birthDate: string) {
  const today = new Date()
  const birth = new Date(`${birthDate}T00:00:00`)
  return today.getFullYear() - birth.getFullYear() - (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0)
}

function App() {
  const [integrations, setIntegrations] = useState(() => readStored('plid27.v27.integrations', initialIntegrations))
  const [audit, setAudit] = useState(() => readStored('plid27.v27.audit', initialAudit))
  const [users, setUsers] = useState(() => readStored('plid27.v27.users', initialUsers))
  const [selectedId, setSelectedId] = useState('banco')
  const [view, setView] = useState<View>(initialGatewayRequest.bound ? 'gateway' : 'home')
  const [query, setQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatus | 'all'>('all')
  const [selectedUserId, setSelectedUserId] = useState('user-lucia')
  const [statusFilter, setStatusFilter] = useState<'all' | IntegrationStatus>('all')
  const [newAppOpen, setNewAppOpen] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [planInfoOpen, setPlanInfoOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [simAppId, setSimAppId] = useState('joven')
  const [simServiceId, setSimServiceId] = useState('ventajas')
  const [simUserId, setSimUserId] = useState('user-lucia')
  const [simAge, setSimAge] = useState(() => calculateAge(initialUsers[0].birthDate))
  const [simRole, setSimRole] = useState<Role>(initialUsers[0].role)
  const [gatewayDip, setGatewayDip] = useState('')
  const [gatewayStage, setGatewayStage] = useState<GatewayStage>('entry')
  const [gatewayUserId, setGatewayUserId] = useState('')
  const [gatewayError, setGatewayError] = useState('')
  const [gatewayOtp, setGatewayOtp] = useState('')
  const [gatewayRequestId, setGatewayRequestId] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null)
  const [gatewayAppId, setGatewayAppId] = useState(initialGatewayRequest.appId)
  const [gatewayServiceId, setGatewayServiceId] = useState(initialGatewayRequest.serviceId)
  const [consentPrompt, setConsentPrompt] = useState<{ userId: string; appId: string; field: ProtectedField } | null>(null)
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('plid27.adminToken') || '')
  const [adminSyncing, setAdminSyncing] = useState(false)

  useEffect(() => localStorage.setItem('plid27.v27.integrations', JSON.stringify(integrations)), [integrations])
  useEffect(() => localStorage.setItem('plid27.v27.audit', JSON.stringify(audit)), [audit])
  useEffect(() => localStorage.setItem('plid27.v27.users', JSON.stringify(users)), [users])
  useEffect(() => {
    if (view !== 'applications' || adminSyncing) return
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
      if (response.ok) setIntegrations(await response.json())
      else if (response.status === 401) { localStorage.removeItem('plid27.adminToken'); setAdminToken(''); showToast('La sesión de Administración ha caducado') }
      else showToast('No se pudo cargar el catálogo desde Supabase')
      setAdminSyncing(false)
    }
    void loadAdminCatalog().catch(() => { setAdminSyncing(false); showToast('API de Administración no disponible') })
  }, [view])

  const selected = integrations.find((item) => item.id === selectedId) ?? integrations[0]
  const visibleIntegrations = useMemo(() => integrations.filter((item) => {
    const matchesQuery = `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'all' || item.status === statusFilter)
  }), [integrations, query, statusFilter])
  const authorizedCount = integrations.filter((item) => item.status === 'authorized').length
  const pendingCount = integrations.filter((item) => item.status === 'pending').length
  const restrictionCount = integrations.flatMap((item) => item.services).filter((service) => !service.enabled || service.minAge > 0).length
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0]
  const gatewayUser = users.find((user) => user.id === gatewayUserId)
  const simIdentity = users.find((user) => user.id === simUserId) ?? users[0]
  const visibleUsers = users.filter((user) => {
    const matchesQuery = `${user.dip} ${user.placeid} ${user.name} ${user.surname} ${user.email}`.toLowerCase().includes(userQuery.toLowerCase())
    return matchesQuery && (userStatusFilter === 'all' || user.status === userStatusFilter)
  })
  const pendingConsentCount = users.reduce((count, user) => count + user.permissions.filter((permission) => permission.status === 'pending').length, 0)
  const gatewayApp = integrations.find((item) => item.id === gatewayAppId)
  const gatewayService = gatewayApp?.services.find((service) => service.id === gatewayServiceId) ?? gatewayApp?.services[0]
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

  function updateIntegration(id: string, update: (item: Integration) => Integration) {
    setIntegrations((current) => {
      const next = current.map((item) => item.id === id ? update(item) : item)
      const changed = next.find((item) => item.id === id)
      if (changed && adminToken) void fetch(`/api/admin/apps/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: changed.name, description: changed.description || '', category: changed.category, redirect_uris: changed.redirectUris || [], status: changed.status, min_age: changed.minAge, allowed_roles: changed.roles, scopes: changed.scopes }) })
      return next
    })
  }

  function updateUser(id: string, update: (user: ManagedUser) => ManagedUser) {
    setUsers((current) => current.map((user) => user.id === id ? update(user) : user))
  }

  function updateConsent(userId: string, appId: string, field: ProtectedField, status: ConsentStatus) {
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
    if (!existing || existing.status === 'denied' || existing.status === 'revoked') updateConsent(userId, appId, field, 'pending')
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
    updateUser(user.id, (current) => {
      const appOverrides = { ...current.appOverrides }
      if (blocked) delete appOverrides[app.id]
      else appOverrides[app.id] = 'deny'
      return { ...current, appOverrides }
    })
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
    updateUser(user.id, (current) => ({ ...current, auth: { mobile: false, authenticator: false, desktop: false } }))
    addAudit('Sesiones y dispositivos revocados', `${user.name} ${user.surname} · ${user.placeid}`)
    showToast('Sesiones y dispositivos revocados')
  }

  async function submitGatewayDip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGatewayError('')
    const dip = gatewayDip.replace(/[\s-]/g, '').toUpperCase()
    if (!/^\d{8}[A-Z]$/.test(dip)) {
      setGatewayError('Introduce el DIP completo: 8 números y una letra.')
      return
    }
    if (initialGatewayRequest.bound) {
      if (!initialGatewayRequest.valid) { setGatewayError('La aplicación o redirect_uri no está autorizado.'); return }
      try {
        const params = new URLSearchParams(window.location.search)
        const response = await fetch('/api/public/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dip, clientId: params.get('client_id') || params.get('clientId'), redirectUri: params.get('redirect_uri'), serviceKey: params.get('service') || params.get('service_key') || undefined, state: params.get('state') || undefined }) })
        const payload = await response.json()
        if (!response.ok) { setGatewayError(payload.message || 'No se pudo iniciar la autenticación.'); return }
        setGatewayRequestId(payload.requestId)
      } catch { setGatewayError('No se pudo contactar con el servicio de identidad.'); return }
    }
    const user = users.find((item) => item.dip === dip)
    if (!user) {
      setGatewayError('No encontramos una identidad con ese DIP.')
      return
    }
    setGatewayUserId(user.id)
    setSelectedUserId(user.id)
    setGatewayOtp('')
    setTermsAccepted(false)
    setPrivacyAccepted(false)
    setLegalDocument(null)
    setGatewayStage('detected')
  }

  async function confirmGatewayIdentity() {
    if (!gatewayUser) return
    const method = authMethod(gatewayUser)
    if (!method) {
      setGatewayError('No hay una sesión válida vinculada. Inicia una recuperación de acceso desde Administración.')
      return
    }
    if (method === 'authenticator' && !/^\d{6}$/.test(gatewayOtp)) {
      setGatewayError('Introduce el código de seis cifras del Autentificador.')
      return
    }
    if (gatewayUser.status === 'suspended' || gatewayUser.status === 'closed') {
      setGatewayError(`La cuenta está ${userStatusLabel(gatewayUser.status).toLowerCase()}. Contacta con Administración.`)
      return
    }
    if (gatewayRequestId && method === 'authenticator') {
      const response = await fetch('/api/public/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: gatewayRequestId, code: gatewayOtp }) })
      const payload = await response.json()
      if (!response.ok) { setGatewayError(payload.message || 'El código del Autentificador no es válido.'); return }
      if (payload.stage === 'legal_required') { setGatewayStage('legal'); return }
      if (payload.stage === 'complete') { setGatewayStage('authenticated'); return }
      setGatewayError('La autenticación no se ha completado.'); return
    }
    if (gatewayRequestId && (method === 'mobile' || method === 'desktop')) {
      setGatewayError('Aprueba la solicitud desde tu dispositivo vinculado…')
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const response = await fetch(`/api/public/auth-requests/${encodeURIComponent(gatewayRequestId)}`)
        const payload = await response.json()
        if (payload.stage === 'complete') { setGatewayStage('authenticated'); setGatewayError(''); return }
        if (payload.stage === 'denied') { setGatewayError('La solicitud fue rechazada en el dispositivo.'); return }
      }
      setGatewayError('La solicitud ha caducado o no fue aprobada.'); return
    }
    if (gatewayUser.legalAcceptedVersions?.includes(LEGAL_VERSION)) {
      finishGatewayAuthentication(gatewayUser, method)
      return
    }
    setGatewayStage('legal')
    setGatewayError('')
  }

  function finishGatewayAuthentication(user: ManagedUser, method: NonNullable<ReturnType<typeof authMethod>>) {
    setGatewayStage('authenticated')
    addAudit(`Inicio de sesión con ${method === 'mobile' ? 'PlacetaID móvil' : method === 'authenticator' ? 'Autentificador' : 'PlacetaID Desktop'}`, `${user.name} ${user.surname} · ${user.placeid}`)
  }

  function acceptLegalDocuments() {
    if (!gatewayUser || !termsAccepted || !privacyAccepted) {
      setGatewayError('Acepta los términos y la política de privacidad para continuar.')
      return
    }
    updateUser(gatewayUser.id, (user) => ({ ...user, legalAcceptedVersions: [...new Set([...(user.legalAcceptedVersions ?? []), LEGAL_VERSION])] }))
    setGatewayError('')
    const method = authMethod(gatewayUser)
    if (method) finishGatewayAuthentication(gatewayUser, method)
  }

  function rejectLegalDocuments() {
    setGatewayStage('entry')
    setGatewayUserId('')
    setGatewayError('Para usar PlacetaID debes aceptar los términos y la política de privacidad.')
  }

  function toggleStatus(item: Integration) {
    const next: IntegrationStatus = item.status === 'authorized' ? 'disabled' : 'authorized'
    updateIntegration(item.id, (current) => ({ ...current, status: next, updated: 'Ahora' }))
    addAudit(next === 'authorized' ? 'Aplicación autorizada' : 'Aplicación desactivada', item.name)
    showToast(next === 'authorized' ? 'Integración autorizada' : 'Integración desactivada')
  }

  function addIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newAppName.trim()
    if (!name) return
    const id = `app-${Date.now()}`
    const item: Integration = {
      id, name, category: 'Nueva integración', initials: name.slice(0, 2).toUpperCase(), color: 'slate', status: 'pending', minAge: 0,
      roles: ['administrador', 'miembro'], scopes: { email: false, phone: false, photo: false, identityVerified: false }, updated: 'Solicitud · ahora',
      services: [{ id: 'general', name: 'Acceso general', description: 'Servicio principal', enabled: true, minAge: 0, roles: null }],
    }
    setIntegrations((current) => [item, ...current])
    setSelectedId(id)
    setNewAppName('')
    setNewAppOpen(false)
    setStatusFilter('all')
    setView('applications')
    addAudit('Nueva solicitud de integración', name)
    showToast('Solicitud añadida al catálogo')
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
    { id: 'email', label: 'Correo electrónico', note: 'Requiere consentimiento individual' },
    { id: 'phone', label: 'Número de teléfono', note: 'Requiere consentimiento individual' },
    { id: 'photo', label: 'Fotografía de perfil', note: 'Requiere consentimiento individual' },
    { id: 'identityVerified', label: 'Identidad verificada', note: 'Solo resultado; el documento nunca se comparte' },
  ]
  const personalPermissionRows = gatewayUser
    ? integrations.flatMap((app) => scopes.filter((scope) => app.scopes[scope.id]).map((scope) => ({ app, scope, record: gatewayUser.permissions.find((permission) => permission.appId === app.id && permission.field === scope.id) })))
    : []

  return (
    <div className={isPublicView ? 'public-shell' : 'app-shell'}>
      {!isPublicView && <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="PlacetaID v27 inicio" onClick={(event) => { event.preventDefault(); setView('gateway'); setGatewayStage('entry'); setGatewayUserId(''); setGatewayDip('') }}>
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
          <header className="public-topbar"><button className="public-brand" onClick={() => { setView('gateway'); setGatewayStage('entry'); setGatewayUserId(''); setGatewayDip('') }}><span className="brand-mark"><Fingerprint size={21} /></span><span><strong>placeta<span>id</span></strong><small>IDENTIDAD DIGITAL</small></span></button><div className="public-topbar-actions">{view === 'myPermissions' && <button className="public-action" onClick={() => setView('gateway')}><ArrowRight className="back-arrow" size={15} />Pasarela</button>}{gatewayStage === 'authenticated' && gatewayUser && view === 'gateway' && <button className="public-action" onClick={() => setView('myPermissions')}><LockKeyhole size={15} />Mis permisos</button>}<button className="admin-entry" onClick={() => setView('applications')}><LockKeyhole size={14} />Administración</button></div></header>
        </> : <>
          <header className="topbar">
            <div className="breadcrumbs"><span>PlacetaID</span><ChevronRight size={14} /><strong>{{ applications: 'Aplicaciones', users: 'Usuarios', permissions: 'Permisos personales', gateway: 'Pasarela DIP', myPermissions: 'Mis permisos', simulator: 'Simulador de acceso', activity: 'Registro de actividad' }[view]}</strong></div>
            <div className="topbar-actions"><span className="environment-pill"><span />ENTORNO DE PRUEBA</span><button className="icon-button" aria-label="Notificaciones" onClick={() => showToast('No hay notificaciones nuevas')}><Bell size={17} /><i /></button><span className="topbar-divider" /><span className="topbar-admin">AM</span></div>
          </header>
          <div className="prototype-banner"><Sparkles size={15} /><span><strong>Vista previa v27</strong><span>Los cambios se guardan en este navegador y aún no aplican en PlacetaID.</span></span><button onClick={() => showToast('La conexión del backend se habilitará en una siguiente fase')}>Estado del sistema <ArrowRight size={14} /></button></div>
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
              <button className="button-primary" onClick={() => setNewAppOpen(true)}><Plus size={16} />Nueva integración</button>
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
                    <td><button className="app-name-cell" onClick={() => setSelectedId(item.id)}><span className={`app-mark app-mark-${item.color}`}>{item.initials}</span><span className="app-cell-copy"><strong>{item.name}</strong><small>{item.category}</small></span></button></td>
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
                <div className="policy-section integration-endpoint-section"><div className="policy-section-heading"><div><h3>Endpoint de la aplicación</h3><p>URL exacta para iniciar PlacetaID</p></div><Code2 size={16} /></div><div className="endpoint-row"><span className="field-label">Client ID</span><code>{selected.clientId ?? 'Pendiente de registrar'}</code></div><label className="field-label" htmlFor="redirect-uris">Redirect URIs permitidas</label><textarea id="redirect-uris" className="redirect-uri-input" rows={3} value={(selected.redirectUris ?? []).join('\n')} placeholder="https://app.ejemplo.org/placetaid/callback" onChange={(event) => updateIntegration(selected.id, (item) => ({ ...item, redirectUris: event.target.value.split(/\n|,/).map((uri) => uri.trim()).filter(Boolean), updated: 'Ahora' }))} /><small className="field-help">Debe coincidir exactamente con el parámetro <code>redirect_uri</code>, incluido protocolo, dominio, puerto y ruta.</small><label className="field-label" htmlFor="platforms">Plataformas compatibles</label><input id="platforms" className="redirect-uri-input" value={(selected.platforms ?? ['Web', 'Apple', 'Android', 'Chrome Extension', 'Windows Desktop']).join(', ')} onChange={(event) => updateIntegration(selected.id, (item) => ({ ...item, platforms: event.target.value.split(',').map((platform) => platform.trim()).filter(Boolean), updated: 'Ahora' }))} /><small className="field-help">Usa el mismo client_id para el ecosistema de la aplicación y registra callbacks específicos por plataforma.</small></div>
                <div className="policy-topline"><span className="eyebrow">FICHA DE INTEGRACIÓN</span><button className="more-button" aria-label="Más opciones" onClick={() => showToast('No hay más acciones disponibles en la vista previa')}><span /><span /><span /></button></div>
                <div className="policy-app-heading"><span className={`app-mark app-mark-large app-mark-${selected.color}`}>{selected.initials}</span><div><h2>{selected.name}</h2><span>{selected.category} <span className="separator-dot">·</span> ID {selected.id.toUpperCase()}</span></div></div>
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
                  <div className="basic-data-list">{['Login correcto', 'Mayor de 16 / 18', 'Nombre y apellidos', 'DIP'].map((item) => <span key={item}><Check size={11} />{item}<small>Siempre</small></span>)}</div>
                  <div className="basic-data-caption">Datos básicos entregados al autenticar. El documento de identidad nunca se comparte.</div>
                  <div className="scope-list">{scopes.map((scope) => <div className={`scope-row ${scope.id === 'email' ? 'scope-sensitive' : ''}`} key={scope.id}><span className="scope-copy"><strong>{scope.label}{scope.id === 'email' && <span className="sensitive-tag">PROTEGIDO</span>}</strong><small>{scope.note}</small></span><label className="data-policy-control"><span>Acceso</span><select aria-label={`Acceso a ${scope.label}`} value={selected.scopes[scope.id] ? 'consent' : 'never'} onChange={(event) => { const canRequest = event.target.value === 'consent'; updateIntegration(selected.id, (item) => ({ ...item, scopes: { ...item.scopes, [scope.id]: canRequest }, updated: 'Ahora' })); addAudit('Política de dato protegido modificada', `${selected.name} · ${scope.label} · ${canRequest ? 'Con consentimiento' : 'Nunca'}`) }}><option value="never">Nunca</option><option value="consent">Si acepta</option></select><ChevronDown size={11} /></label></div>)}</div>
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
            <div className="consent-requests-list">{(selectedUser?.permissions ?? []).map((permission) => { const app = integrations.find((item) => item.id === permission.appId); const allowedByAdmin = Boolean(app?.scopes[permission.field] && app.status === 'authorized'); return <article className="consent-request-row" key={`${permission.appId}-${permission.field}`}><span className={`consent-field-icon consent-field-${permission.field}`}>{permission.field === 'email' ? <Mail size={17} /> : permission.field === 'phone' ? <Phone size={17} /> : permission.field === 'photo' ? <ImageIcon size={17} /> : <BadgeCheck size={17} />}</span><div className="consent-request-copy"><div className="consent-request-title"><strong>{app?.name ?? permission.appId}</strong><span className={`consent-status consent-${permission.status}`}>{consentStatusLabel(permission.status)}</span></div><span>{protectedFieldLabel(permission.field)}</span><small>{permission.status === 'pending' ? `${app?.name ?? 'La aplicación'} quiere acceder a este dato.` : `Actualizado ${permission.updated}`}</small>{!allowedByAdmin && <small className="admin-disallowed">La aplicación no tiene autorización administrativa para solicitar este dato.</small>}</div><div className="consent-actions">{permission.status === 'pending' && <span className="admin-pending-note">Esperando decisión del titular</span>}{permission.status === 'granted' && <span className="admin-pending-note">El titular concedió el permiso</span>}{permission.status === 'denied' && <span className="admin-pending-note">El titular rechazó el permiso</span>}{permission.status === 'revoked' && <span className="admin-pending-note">El titular revocó el permiso</span>}</div></article>})}{(selectedUser?.permissions ?? []).length === 0 && <div className="consent-empty"><LockKeyhole size={19} /><strong>Sin permisos registrados</strong><span>Cuando una aplicación solicite un dato protegido, aparecerá aquí para que el titular decida.</span></div>}</div>
            <div className="permission-principle"><ShieldCheck size={16} /><span><strong>Consentimiento independiente.</strong> Permitir el correo no concede acceso al teléfono ni a la foto. Revocar bloquea inmediatamente ese dato en la respuesta de PlacetaID.</span></div>
          </section>
        </div>}

        {view === 'myPermissions' && <div className="page-content my-permissions-page">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />TU CONTROL DE PRIVACIDAD</div><h1>Mis permisos</h1><p>Decide qué datos protegidos puede utilizar cada aplicación. Puedes cambiarlo cuando quieras.</p></div><span className="simulator-tag"><LockKeyhole size={14} />TITULAR</span></section>
          {gatewayUser ? <section className="my-permissions-panel"><div className="consent-owner"><span className="user-avatar">{gatewayUser.name.slice(0, 1)}{gatewayUser.surname.slice(0, 1)}</span><div><strong>{gatewayUser.name} {gatewayUser.surname}</strong><small>{gatewayUser.placeid} · Identidad verificada en PlacetaID</small></div><span>{personalPermissionRows.filter((row) => row.record?.status === 'granted').length} concedidos</span></div><div className="my-permission-list">{personalPermissionRows.map(({ app, scope, record }) => <article className="my-permission-row" key={`${app.id}-${scope.id}`}><span className={`consent-field-icon consent-field-${scope.id}`}>{scope.id === 'email' ? <Mail size={17} /> : scope.id === 'phone' ? <Phone size={17} /> : scope.id === 'photo' ? <ImageIcon size={17} /> : <BadgeCheck size={17} />}</span><span className="my-permission-copy"><strong>{app.name}</strong><span>{scope.label}</span><small>{record ? `Actualizado ${record.updated}` : 'Este permiso todavía no ha sido concedido.'}</small></span><span className={`consent-status consent-${record?.status ?? 'revoked'}`}>{record ? consentStatusLabel(record.status) : 'No concedido'}</span>{record?.status === 'granted' ? <button className="button-quiet revoke-button" onClick={() => updateConsent(gatewayUser.id, app.id, scope.id, 'revoked')}>Revocar</button> : !record || record.status === 'denied' || record.status === 'revoked' ? <button className="button-quiet" disabled={!app.scopes[scope.id] || app.status !== 'authorized'} onClick={() => requestConsent(gatewayUser.id, app.id, scope.id)}>Solicitar permiso</button> : <span className="admin-pending-note">Solicitud pendiente</span>}</article>)}</div><div className="permission-principle"><ShieldCheck size={16} /><span><strong>Tu decisión es independiente por aplicación y dato.</strong> Si revocas un permiso, ese dato deja de incluirse en las siguientes respuestas de PlacetaID.</span></div></section> : <section className="my-permissions-panel my-permissions-locked"><LockKeyhole size={20} /><strong>Identifícate para revisar tus permisos</strong><button className="button-primary" onClick={() => setView('gateway')}>Ir a la pasarela <ArrowRight size={14} /></button></section>}
        </div>}

        {view === 'gateway' && <div className="page-content gateway-page" data-gateway-stage={gatewayStage}>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />AUTENTICACIÓN SIN CONTRASEÑA</div><h1>Pasarela PlacetaID</h1><p>El DIP localiza la identidad; PlacetaID detecta automáticamente la sesión disponible.</p></div><span className="simulator-tag"><Fingerprint size={14} />FLUJO DE PRUEBA</span></section>
          <div className="gateway-layout"><section className="gateway-flow-panel"><h1 className="gateway-wordmark">PlacetaID</h1><p className="gateway-tagline">La identificación de La Placeta</p><div className="gateway-step-heading"><span className={`step-number ${gatewayStage !== 'entry' ? 'step-complete' : ''}`}>{gatewayStage === 'entry' ? '01' : <Check size={13} />}</span><div><h2>Identifica tu cuenta</h2><p>Introduce tu DIP asociado a PlacetaID.</p></div></div>
            {gatewayStage === 'entry' ? <form className="gateway-form" onSubmit={submitGatewayDip}><label className="field-label" htmlFor="gateway-dip">DIP</label><input id="gateway-dip" className="gateway-dip-input" value={gatewayDip} onChange={(event) => { setGatewayDip(event.target.value.toUpperCase()); setGatewayError('') }} placeholder="12345678Z" maxLength={11} autoComplete="off" required /><p className="gateway-input-note"><LockKeyhole size={13} />El DIP identifica la cuenta. No es una contraseña.</p>{gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}<button className="button-primary gateway-continue" type="submit">Continuar <ArrowRight size={15} /></button></form> : <div className="gateway-identified"><span className="user-avatar user-avatar-large">{gatewayUser?.name.slice(0, 1)}{gatewayUser?.surname.slice(0, 1)}</span><div><strong>{gatewayUser?.name} {gatewayUser?.surname}</strong><small>{gatewayUser?.placeid} · Identidad localizada</small></div><button className="text-action" onClick={() => { setGatewayStage('entry'); setGatewayUserId(''); setGatewayError('') }}>Cambiar DIP</button></div>}

            {gatewayStage === 'detected' && gatewayUser && <div className="method-detection"><div className="gateway-step-heading"><span className="step-number">02</span><div><h2>Método detectado</h2><p>PlacetaID elige la sesión disponible de mayor prioridad.</p></div></div><div className="priority-method-list">{[{ id: 'mobile', label: 'PlacetaID móvil', note: 'Sesión activa en tu teléfono', icon: <Smartphone size={16} />, available: gatewayUser.auth.mobile }, { id: 'authenticator', label: 'Autentificador', note: 'Sesión válida en el autenticador', icon: <KeyRound size={16} />, available: gatewayUser.auth.authenticator }, { id: 'desktop', label: 'PlacetaID Desktop', note: 'Cliente de escritorio vinculado', icon: <Monitor size={16} />, available: gatewayUser.auth.desktop }].map((method) => <div className={`priority-method ${authMethod(gatewayUser) === method.id ? 'priority-method-selected' : ''} ${!method.available ? 'priority-method-off' : ''}`} key={method.id}><span className="priority-method-icon">{method.icon}</span><span><strong>{method.label}</strong><small>{method.note}</small></span><span className="priority-method-state">{authMethod(gatewayUser) === method.id ? 'SELECCIONADO' : method.available ? 'DISPONIBLE' : 'NO DISPONIBLE'}</span></div>)}</div>
              {authMethod(gatewayUser) === 'authenticator' && <label className="field-label gateway-otp-label" htmlFor="gateway-otp">Código del Autentificador</label>}{authMethod(gatewayUser) === 'authenticator' && <input className="gateway-otp-input" id="gateway-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={gatewayOtp} onChange={(event) => { setGatewayOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setGatewayError('') }} placeholder="000000" />}
              {!authMethod(gatewayUser) && <div className="gateway-error gateway-no-method"><ShieldAlert size={16} />No hay una sesión vinculada. Solicita recuperación de acceso.</div>}{gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}{authMethod(gatewayUser) && <button className="button-primary gateway-continue" onClick={confirmGatewayIdentity}>{authMethod(gatewayUser) === 'mobile' ? 'Confirmar identidad en móvil' : authMethod(gatewayUser) === 'authenticator' ? 'Verificar código' : 'Continuar con PlacetaID Desktop'} <ArrowRight size={15} /></button>}
            </div>}

            {gatewayStage === 'legal' && gatewayUser && <div className="legal-consent-step"><div className="gateway-step-heading"><span className="step-number">03</span><div><h2>Antes de continuar</h2><p>Revisa y acepta los documentos de uso de PlacetaID.</p></div></div><div className="legal-document-links"><button onClick={() => setLegalDocument('terms')}><ShieldCheck size={16} /><span><strong>Términos y condiciones</strong><small>Uso de la identidad y acceso a servicios</small></span><ArrowRight size={14} /></button><button onClick={() => setLegalDocument('privacy')}><LockKeyhole size={16} /><span><strong>Política de privacidad</strong><small>Datos utilizados y control del titular</small></span><ArrowRight size={14} /></button></div><label className="legal-accept-option"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span className="custom-check"><Check size={11} /></span><span>He leído y acepto los <button type="button" className="inline-legal-link" onClick={() => setLegalDocument('terms')}>términos y condiciones</button>.</span></label><label className="legal-accept-option"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span className="custom-check"><Check size={11} /></span><span>He leído la <button type="button" className="inline-legal-link" onClick={() => setLegalDocument('privacy')}>política de privacidad</button> y entiendo el uso de mis datos.</span></label>{gatewayError && <p className="gateway-error" role="alert">{gatewayError}</p>}<div className="legal-step-actions"><button className="button-quiet" onClick={rejectLegalDocuments}>No acepto</button><button className="button-primary" disabled={!termsAccepted || !privacyAccepted} onClick={acceptLegalDocuments}>Aceptar y continuar <ArrowRight size={14} /></button></div><small className="legal-version-note">Documentos v27 · {LEGAL_VERSION}</small></div>}

            {gatewayStage === 'authenticated' && gatewayUser && <div className="gateway-authenticated"><span className="gateway-auth-icon"><ShieldCheck size={18} /></span><div><strong>Identidad autenticada</strong><small>{gatewayUser.name} {gatewayUser.surname} · {gatewayUser.dip}</small></div><button className="text-action" onClick={() => { setGatewayStage('entry'); setGatewayUserId(''); setGatewayError('') }}>Cerrar sesión de prueba</button></div>}
          </section>

          <section className="gateway-policy-panel"><div className="gateway-step-heading"><span className={`step-number ${gatewayStage === 'authenticated' ? 'step-complete' : ''}`}>{gatewayStage === 'authenticated' ? <Check size={13} /> : '02'}</span><div><h2>{gatewayStage === 'authenticated' ? 'Autorización de la aplicación' : 'Detección de sesión'}</h2><p>{gatewayStage === 'authenticated' ? 'Aplicación, servicio, edad y permisos personales.' : 'PlacetaID comprobará móvil, Autentificador y Desktop en ese orden.'}</p></div></div>
            {gatewayStage !== 'authenticated' || !gatewayUser ? <div className="gateway-locked-state"><LockKeyhole size={20} /><strong>Esperando la autenticación</strong><span>La disponibilidad se comprobará después de identificar y autenticar al titular.</span></div> : <>
              <label className="field-label" htmlFor="gateway-app">Aplicación solicitante</label><div className="select-control"><select id="gateway-app" value={gatewayAppId} onChange={(event) => { const appId = event.target.value; setGatewayAppId(appId); setGatewayServiceId(integrations.find((item) => item.id === appId)?.services[0]?.id ?? '') }}>{integrations.map((app) => <option value={app.id} key={app.id}>{app.name} · {statusLabel(app.status)}</option>)}</select><ChevronDown size={14} /></div>
              <label className="field-label" htmlFor="gateway-service">Servicio</label><div className="select-control"><select id="gateway-service" value={gatewayService?.id ?? ''} onChange={(event) => setGatewayServiceId(event.target.value)}>{(gatewayApp?.services ?? []).map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select><ChevronDown size={14} /></div>
              {gatewayApp && gatewayService && <>{(() => { const decision = accessDecision(gatewayUser, gatewayApp, gatewayService); return <div className={`gateway-decision ${decision.allowed ? 'gateway-decision-allow' : 'gateway-decision-deny'}`}><span>{decision.allowed ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}</span><div><strong>{decision.allowed ? 'Acceso concedido' : 'Acceso denegado'}</strong><small>{decision.reason} · {calculateAge(gatewayUser.birthDate)} años</small></div></div>})()}
                {accessDecision(gatewayUser, gatewayApp, gatewayService).allowed && <div className="gateway-consent-list"><div className="consent-list-title"><h3>Datos protegidos</h3><span>Solo se entregan con tu permiso</span></div>{scopes.filter((scope) => gatewayApp.scopes[scope.id]).map((scope) => { const record = gatewayUser.permissions.find((permission) => permission.appId === gatewayApp.id && permission.field === scope.id); const status = record?.status; return <div className="gateway-consent-row" key={scope.id}><span className="consent-field-icon">{scope.id === 'email' ? <Mail size={15} /> : scope.id === 'phone' ? <Phone size={15} /> : scope.id === 'photo' ? <ImageIcon size={15} /> : <BadgeCheck size={15} />}</span><div><strong>{gatewayApp.name} quiere acceder a {scope.label.toLowerCase()}</strong><small>{status === 'granted' ? `Permiso concedido · ${record?.updated}` : status === 'pending' ? 'Esta solicitud espera tu decisión.' : status === 'revoked' ? 'Has revocado este permiso.' : status === 'denied' ? 'No has permitido este dato.' : 'Esta aplicación solicita permiso para utilizar este dato.'}</small></div><div className="gateway-consent-actions">{status === 'pending' && <button className="consent-review-button" onClick={() => setConsentPrompt({ userId: gatewayUser.id, appId: gatewayApp.id, field: scope.id })}>Revisar solicitud</button>}{status === 'granted' && <button className="consent-revoke-button" onClick={() => updateConsent(gatewayUser.id, gatewayApp.id, scope.id, 'revoked')}>Revocar</button>}{(!status || status === 'denied' || status === 'revoked') && <button className="consent-request-button" onClick={() => requestConsent(gatewayUser.id, gatewayApp.id, scope.id)}>{status ? 'Solicitar de nuevo' : 'Solicitar permiso'}</button>}</div></div>})}</div>}
                <div className="gateway-response"><div className="payload-heading"><div><h3>Respuesta de PlacetaID</h3><p>Sin documento de identidad ni datos sin permiso</p></div><span className="json-chip">JSON</span></div><pre className="payload-code">{JSON.stringify(accessDecision(gatewayUser, gatewayApp, gatewayService).allowed ? {
                  login_correct: true,
                  over_16: calculateAge(gatewayUser.birthDate) >= 16,
                  over_18: calculateAge(gatewayUser.birthDate) >= 18,
                  name: gatewayUser.name,
                  surname: gatewayUser.surname,
                  dip: gatewayUser.dip,
                  ...(gatewayApp.scopes.email && gatewayUser.permissions.some((permission) => permission.appId === gatewayApp.id && permission.field === 'email' && permission.status === 'granted') ? { email: gatewayUser.email } : {}),
                  ...(gatewayApp.scopes.phone && gatewayUser.permissions.some((permission) => permission.appId === gatewayApp.id && permission.field === 'phone' && permission.status === 'granted') ? { phone: gatewayUser.phone } : {}),
                  ...(gatewayApp.scopes.photo && gatewayUser.permissions.some((permission) => permission.appId === gatewayApp.id && permission.field === 'photo' && permission.status === 'granted') ? { profile_photo: `/demo/${gatewayUser.id}/avatar` } : {}),
                  ...(gatewayApp.scopes.identityVerified && gatewayUser.identityVerified && gatewayUser.permissions.some((permission) => permission.appId === gatewayApp.id && permission.field === 'identityVerified' && permission.status === 'granted') ? { identity_verified: true } : {}),
                } : { login_correct: false }, null, 2)}</pre></div>
              </>}
            </>}
          </section></div>
          <div className="gateway-privacy-footer"><LockKeyhole size={14} /><span>El documento de identidad permanece cifrado en PlacetaID. Esta pasarela es una simulación local, no autentica cuentas reales.</span></div>
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
              dip: simIdentity?.dip,
              ...(simApp.scopes.email && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'email' && permission.status === 'granted') ? { email: simIdentity.email } : {}),
              ...(simApp.scopes.phone && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'phone' && permission.status === 'granted') ? { phone: simIdentity.phone } : {}),
              ...(simApp.scopes.photo && simIdentity?.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'photo' && permission.status === 'granted') ? { profile_photo: `/demo/${simIdentity.id}/avatar` } : {}),
              ...(simApp.scopes.identityVerified && simIdentity?.identityVerified && simIdentity.permissions.some((permission) => permission.appId === simApp.id && permission.field === 'identityVerified' && permission.status === 'granted') ? { identity_verified: true } : {}),
            } : { login_correct: false }, null, 2)}</pre><div className="payload-footnote"><Fingerprint size={13} />El documento de identidad nunca se incluye en la respuesta.</div></div>
          </section></div>
        </div>}

        {view === 'activity' && <div className="page-content activity-page"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />TRAZABILIDAD</div><h1>Registro de actividad</h1><p>Historial local de cambios realizados en esta vista previa.</p></div><span className="local-only-tag"><Activity size={14} />REGISTRO LOCAL</span></section><section className="activity-panel"><div className="activity-panel-heading"><div><h2>Últimos cambios</h2><p>Las acciones quedan vinculadas a la integración afectada.</p></div><span className="total-chip">{audit.length} eventos</span></div>{audit.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-icon"><ClipboardCheck size={16} /></span><div><strong>{entry.action}</strong><small>{entry.subject}</small></div><time>{entry.time}</time></div>)}</section></div>}

        {isPublicView ? <footer className="public-footer"><span>PlacetaID v27.0 <i>·</i> Plan 2027 · Ámbito 25</span><span>Maqueta de transición · 2026—2027</span></footer> : <footer className="app-footer"><span><span className="footer-mark"><Fingerprint size={13} /></span>PlacetaID v27.0 <span className="footer-dot">·</span> Gobierno de identidad</span><span>Panel de Administración <span className="footer-dot">·</span> Vista previa</span></footer>}
      </main>

      {newAppOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewAppOpen(false) }}><form className="integration-modal" onSubmit={addIntegration}><div className="modal-topline"><span className="modal-icon"><Plus size={18} /></span><button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setNewAppOpen(false)}><X size={17} /></button></div><h2>Nueva integración</h2><p>Registra una aplicación para que Administración revise su solicitud de acceso.</p><label className="field-label" htmlFor="new-app-name">Nombre de la aplicación</label><input className="modal-input" id="new-app-name" autoFocus maxLength={60} value={newAppName} onChange={(event) => setNewAppName(event.target.value)} placeholder="Ej. Portal de servicios" required /><div className="modal-info"><ShieldAlert size={15} /><span>La nueva integración quedará pendiente y no podrá autenticar usuarios hasta ser autorizada.</span></div><div className="modal-actions"><button className="button-quiet" type="button" onClick={() => setNewAppOpen(false)}>Cancelar</button><button className="button-primary" type="submit"><Plus size={15} />Añadir solicitud</button></div></form></div>}
      {consentPrompt && <div className="modal-backdrop consent-modal-backdrop" role="presentation"><section className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title"><div className="consent-modal-top"><span className="consent-modal-icon"><LockKeyhole size={18} /></span><button className="icon-button" aria-label="Cerrar solicitud" onClick={() => setConsentPrompt(null)}><X size={16} /></button></div><div className="eyebrow"><span className="eyebrow-line" />SOLICITUD DE DATO PROTEGIDO</div><h2 id="consent-modal-title">{integrations.find((app) => app.id === consentPrompt.appId)?.name ?? 'Esta aplicación'} quiere acceder a {protectedFieldLabel(consentPrompt.field).toLowerCase()}.</h2><p>Esta aplicación solicita permiso para utilizar este dato asociado a tu PlacetaID. La autorización solo se aplica a esta aplicación y puedes revocarla después.</p><div className="consent-modal-data"><span>{protectedFieldLabel(consentPrompt.field)}</span><span>Tu permiso, siempre revocable</span></div><div className="modal-actions"><button className="button-quiet" onClick={() => resolveConsentPrompt('denied')}>No permitir</button><button className="button-primary" onClick={() => resolveConsentPrompt('granted')}><Check size={14} />Permitir</button></div></section></div>}
      {legalDocument && <div className="modal-backdrop legal-document-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLegalDocument(null) }}><section className="legal-document-modal" role="dialog" aria-modal="true" aria-labelledby="legal-document-title"><div className="consent-modal-top"><span className="consent-modal-icon">{legalDocument === 'terms' ? <ShieldCheck size={18} /> : <LockKeyhole size={18} />}</span><button className="icon-button" aria-label="Cerrar documento" onClick={() => setLegalDocument(null)}><X size={16} /></button></div><span className="eyebrow">PLACETAID v27 · {LEGAL_VERSION}</span><h2 id="legal-document-title">{legalDocument === 'terms' ? 'Términos y condiciones' : 'Política de privacidad'}</h2>{legalDocument === 'terms' ? <div className="legal-document-copy"><h3>Uso del servicio</h3><p>PlacetaID identifica al titular y aplica las restricciones definidas por Administración para cada aplicación y servicio. El inicio de sesión no garantiza que todos los servicios estén disponibles.</p><h3>Datos básicos y protegidos</h3><p>En un acceso permitido se comparten los indicadores de edad, nombre, apellidos y DIP. Correo, teléfono, fotografía y otros datos protegidos solo se entregan con autorización administrativa y consentimiento específico del titular.</p><h3>Seguridad y disponibilidad</h3><p>El titular debe proteger sus métodos vinculados. Administración puede suspender cuentas, servicios o integraciones por seguridad o incumplimiento; las acciones administrativas sensibles quedan auditadas.</p></div> : <div className="legal-document-copy"><h3>Responsable y finalidad</h3><p>Responsable: Grupo de La Placeta. PlacetaID utiliza datos de identidad para localizar la cuenta, autenticar al titular, determinar elegibilidad por edad y controlar el acceso a aplicaciones autorizadas.</p><h3>Datos y minimización</h3><p>Los datos básicos se limitan a login correcto, indicadores de edad, nombre, apellidos y DIP. Los datos protegidos se solicitan de uno en uno; nunca se comparte una copia del documento de identidad durante el inicio de sesión.</p><h3>Consentimiento y derechos</h3><p>Puedes consultar y revocar permisos por aplicación y dato desde «Mis permisos». Para ejercer derechos de acceso, rectificación, supresión u oposición, contacta con Administración de La Placeta. El plazo de conservación y el contacto del responsable deben completarse antes del despliegue.</p></div>}<div className="legal-draft-note">Versión inicial para revisión jurídica antes de uso real.</div><button className="button-primary legal-document-close" onClick={() => setLegalDocument(null)}>Cerrar documento</button></section></div>}
      {isPublicView && <button className="floating-plan-button" aria-haspopup="dialog" onClick={() => setPlanInfoOpen(true)}><span className="floating-plan-number">25</span><span><small>PLAN 2027</small><strong>Transformación digital</strong></span><ArrowRight size={15} /></button>}
      {planInfoOpen && <div className="plan-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlanInfoOpen(false) }}><section className="plan-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title"><div className="plan-dialog-top"><span>PLAN 2027 <i>·</i> ÁMBITO 25</span><button className="icon-button" aria-label="Cerrar detalle del Plan 2027" onClick={() => setPlanInfoOpen(false)}><X size={16} /></button></div><h2 id="plan-dialog-title">Fomento de la transformación digital</h2><p>Impulso de la modernización tecnológica de organizaciones, proyectos y servicios.</p><div className="plan-transition"><span>PlacetaID v27</span><strong>En transición desde 2026</strong></div><button className="button-primary" onClick={() => setPlanInfoOpen(false)}>Cerrar</button></section></div>}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </div>
  )
}

export default App
