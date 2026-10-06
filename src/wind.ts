export interface Wind {
  speed: number // km/h
  direction: number // degrees clockwise from north, the direction the wind blows FROM
}

// Trincomalee harbour
const URL =
  'https://api.open-meteo.com/v1/forecast?latitude=8.5874&longitude=81.2152' +
  '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh'

export async function fetchWind(): Promise<Wind> {
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`)
  const { current } = await res.json()
  return { speed: current.wind_speed_10m, direction: current.wind_direction_10m }
}

export function compass(degrees: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]
}
