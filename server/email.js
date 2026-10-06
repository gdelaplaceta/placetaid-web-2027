export async function sendPasswordResetEmail({ to, url, dip, userName, adminName }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from || !to) return { sent: false, reason: 'MAIL_NOT_CONFIGURED' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Enlace seguro de cambio de contraseña para ${dip}`,
      html: `<h2>Nuevo acceso para ${userName}</h2><p>La identidad ${dip} fue creada por ${adminName}.</p><p>El enlace siguiente permite cambiar la contraseña una sola vez y caducará en 48 horas.</p><p><a href="${url}">Cambiar contraseña</a></p><p>Si no reconoces esta operación, contacta con Administración.</p>`,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    return { sent: false, reason: payload.message || 'RESEND_REQUEST_FAILED' }
  }
  return { sent: true }
}
