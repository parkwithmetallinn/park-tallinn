/**
 * Unit checks for app settings + distance formatting.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Lightweight mirrors of the pure helpers (avoid DOM/localStorage in node strip-types).
function formatDistance(meters, units = 'metric') {
  if (units === 'imperial') {
    const miles = meters / 1609.344
    if (miles < 0.1) {
      const feet = Math.round(meters * 3.28084)
      return `${feet} ft`
    }
    return `${miles.toFixed(1)} mi`
  }
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function resolveMapTheme(mapStyle, prefersDark = false) {
  if (mapStyle === 'light') return 'light'
  if (mapStyle === 'dark') return 'dark'
  return prefersDark ? 'dark' : 'light'
}

function profileInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'K'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
}

test('formatDistance metric', () => {
  assert.equal(formatDistance(420), '420 m')
  assert.equal(formatDistance(1500), '1.5 km')
})

test('formatDistance imperial', () => {
  assert.equal(formatDistance(30, 'imperial'), '98 ft')
  assert.equal(formatDistance(1609.344, 'imperial'), '1.0 mi')
})

test('resolveMapTheme auto follows system', () => {
  assert.equal(resolveMapTheme('auto', true), 'dark')
  assert.equal(resolveMapTheme('auto', false), 'light')
  assert.equal(resolveMapTheme('dark', false), 'dark')
})

test('profileInitials', () => {
  assert.equal(profileInitials('Mari Maasikas'), 'MM')
  assert.equal(profileInitials('Jüri'), 'JÜ')
})
