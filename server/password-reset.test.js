import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPasswordResetUrl,
  createPasswordResetExpiry,
  generateDip,
  isValidPassword,
  makePasswordResetToken,
  PASSWORD_RESET_LINK_TTL_MS,
} from './password-reset.js'

test('generateDip creates eight digits ending with the final-name initial', () => {
  const dip = generateDip('G', () => 7)
  assert.equal(dip, '77777777G')
})

test('makePasswordResetToken returns a cryptographically secure URL-safe token', () => {
  const first = makePasswordResetToken()
  const second = makePasswordResetToken()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
})

test('buildPasswordResetUrl preserves the token in the reset URL', () => {
  const token = 'A'.repeat(43)
  const url = buildPasswordResetUrl('https://admin.example.com', token)
  assert.equal(url, 'https://admin.example.com/reset-password?token=' + token)
})

test('the password reset link lasts exactly 48 hours', () => {
  assert.equal(PASSWORD_RESET_LINK_TTL_MS, 48 * 60 * 60 * 1000)
  assert.equal(createPasswordResetExpiry(0), new Date(48 * 60 * 60 * 1000).toISOString())
})

test('isValidPassword enforces a secure password shape', () => {
  assert.equal(isValidPassword('Abcdef12'), true)
  assert.equal(isValidPassword('short'), false)
  assert.equal(isValidPassword('allletters'), false)
  assert.equal(isValidPassword('Abcdef!'), false)
})
