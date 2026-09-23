import type { DistrictZone } from '../types'

/**
 * Linnaosa / piirkonna tsoonid — välja zoomides kuvatakse polügoonidena
 * koos kohalike parkimiskohtade arvuga (arvutatakse dünaamiliselt).
 * Koordinaadid: [lat, lng] nagu PaidZone.
 */
export const DISTRICT_ZONES: DistrictZone[] = [
  {
    id: 'd-kesklinn',
    name: 'Kesklinn',
    color: '#0F766E',
    kind: 'mixed',
    summary: 'Tasuline tsoon · öösel & pühapäeval tasuta',
    coords: [
      [59.445, 24.73],
      [59.448, 24.77],
      [59.428, 24.785],
      [59.418, 24.75],
      [59.425, 24.72],
    ],
  },
  {
    id: 'd-pohja',
    name: 'Põhja-Tallinn',
    color: '#0B6E4F',
    kind: 'free',
    summary: 'Enamik tänavaid tasuta väljaspool tsooni',
    coords: [
      [59.46, 24.66],
      [59.462, 24.73],
      [59.448, 24.74],
      [59.44, 24.7],
      [59.445, 24.65],
    ],
  },
  {
    id: 'd-mustamae',
    name: 'Mustamäe',
    color: '#1D4E89',
    kind: 'free',
    summary: 'Elamupiirkonna tasuta tänavad & parklad',
    coords: [
      [59.415, 24.64],
      [59.42, 24.7],
      [59.395, 24.71],
      [59.39, 24.65],
      [59.4, 24.63],
    ],
  },
  {
    id: 'd-lasnamae',
    name: 'Lasnamäe',
    color: '#0369A1',
    kind: 'free',
    summary: 'Laialdane tasuta tänavaparkimine',
    coords: [
      [59.45, 24.78],
      [59.452, 24.88],
      [59.42, 24.89],
      [59.415, 24.79],
      [59.43, 24.77],
    ],
  },
  {
    id: 'd-kristiine',
    name: 'Kristiine',
    color: '#4D7C0F',
    kind: 'free',
    summary: 'Tasuta tänavad tsooni piiri taga',
    coords: [
      [59.435, 24.69],
      [59.435, 24.73],
      [59.41, 24.74],
      [59.405, 24.69],
      [59.42, 24.68],
    ],
  },
  {
    id: 'd-haabersti',
    name: 'Haabersti / Õismäe',
    color: '#0E7490',
    kind: 'free',
    summary: 'Tasuta elamutänavad · P&R lähedal',
    coords: [
      [59.44, 24.58],
      [59.44, 24.66],
      [59.405, 24.67],
      [59.4, 24.6],
      [59.42, 24.57],
    ],
  },
  {
    id: 'd-nomme',
    name: 'Nõmme',
    color: '#15803D',
    kind: 'free',
    summary: 'Peaaegu kõik tänavad tasuta',
    coords: [
      [59.4, 24.64],
      [59.4, 24.72],
      [59.36, 24.72],
      [59.355, 24.6],
      [59.38, 24.59],
    ],
  },
  {
    id: 'd-pirita',
    name: 'Pirita',
    color: '#0284C7',
    kind: 'mixed',
    summary: 'Ranna tsoon tasuline · elamud tasuta',
    coords: [
      [59.48, 24.8],
      [59.485, 24.87],
      [59.455, 24.86],
      [59.45, 24.79],
      [59.465, 24.78],
    ],
  },
]
