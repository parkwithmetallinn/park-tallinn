export type Locale = 'et' | 'en' | 'ru'

export const LOCALES: Locale[] = ['et', 'en', 'ru']

export const LOCALE_STORAGE_KEY = 'parkvibe_locale_v1'

export const TALLINN_TZ = 'Europe/Tallinn'

/** Nested message tree — same shape in et / en / ru. */
export type MessageTree = {
  common: {
    close: string
    closePanel: string
    cancel: string
    save: string
    loading: string
    retry: string
    back: string
    yes: string
    no: string
    soon: string
    send: string
    destination: string
    lot: string
  }
  lang: {
    title: string
    et: string
    en: string
    ru: string
    system: string
  }
  filters: {
    all: string
    free: string
    clock: string
    paid: string
    ev: string
    other: string
    alerts: string
    aria: string
  }
  search: {
    placeholder: string
    aria: string
    clear: string
    noResults: string
  }
  chrome: {
    favorites: string
    rules: string
    privacy: string
    teave: string
    themeLight: string
    themeDark: string
    themeToLight: string
    themeToDark: string
    hideRoute: string
    locate: string
    locating: string
    locateFollow: string
    locateTitle: string
    view2d: string
    view3d: string
    parkingClock: string
    activeSession: string
    proposeSpot: string
    proposeSpotTitle: string
    outsideEstonia: string
    locationMissing: string
  }
  nearest: {
    title: string
    subtitle: string
    filterAria: string
    listAria: string
    emptyFilter: string
    widenRadius: string
    choose: string
    walkMin: string
    odavaim: string
    kellaga: string
    tasuline: string
    all: string
    checkOnSite: string
  }
  session: {
    title: string
    start: string
    stop: string
    status: string
    extend: string
    starting: string
    started: string
    startFail: string
    stopped: string
    stopFail: string
    statusOk: string
    statusFail: string
    statusChecking: string
    statusActive: string
    extended: string
    extendFail: string
    notifyOk: string
    notifyFail: string
    noActive: string
    noActiveDetail: string
    alreadyRunning: string
    cannotStart: string
    freeSpot: string
    clockSpot: string
    parkRide: string
    offlineQueued: string
    offlineQueuedDetail: string
    offlineStopQueued: string
    connectionLost: string
    pickSpot: string
    timerDefault: string
    endsSoonTitle: string
    endsSoonBody: string
    reminderSaved: string
    zoneMissing: string
    invalidRequest: string
    unknownServer: string
    emptyServer: string
    networkFail: string
    authFail: string
    n8nFail: string
    serverNoConfirm: string
    activeCount: string
    since: string
    prepaidLocal: string
    prepaidOffline: string
    serverNoSession: string
    localTimerContinues: string
    finalPrice: string
    tryAgain: string
    sessionLabel: string
    endFirst: string
    addedMinutes: string
    prepaidPlus: string
    prepaidPlusNamed: string
    localCleared: string
    noActiveWithMsg: string
    connectionWithMsg: string
    elapsedTime: string
    prepaidRemaining: string
  }
  teave: {
    title: string
    mapData: string
    accuracyTitle: string
    accuracyBody: string
    privacy: string
    contact: string
  }
  privacy: {
    agree: string
    remindersBefore: string
    remindersLink: string
    consentRequired: string
  }
  geo: {
    denied: string
    unavailable: string
    timeout: string
    failed: string
    unsupported: string
    inProgress: string
    gpsMissing: string
    gpsMissingRoute: string
  }
  pins: {
    saved: string
    deleted: string
    cannotSave: string
    openInfo: string
    myPin: string
    tooMany: string
    longPressHint: string
    colorAria: string
  }
  toasts: {
    nearestFree: string
    reportCooldown: string
    sending: string
    submittedReview: string
    routeFail: string
    walkRouteMissing: string
    walkRouteFallback: string
    driveRouteMissing: string
    driveWalkOnly: string
  }
  route: {
    byCar: string
    onFoot: string
    approxWalk: string
    longWalk: string
    totalApprox: string
  }
  rules: {
    tallinn: string
    parnu: string
    first15: string
    first15Body: string
    first15Note: string
    zonePrices: string
    zonePricesHint: string
    freeHours: string
    freeHoursWeekday: string
    freeHoursSaturday: string
    freeHoursSunday: string
    mapLegend: string
    mapLegendBody: string
    myPinsTitle: string
    myPinsBody: string
    discFree: string
    minFree: string
  }
  offline: {
    banner: string
    bannerDetail: string
    queueRestored: string
    ends: string
  }
  report: {
    send: string
    full: string
    free: string
    other: string
    typeAria: string
  }
  parking: {
    free: string
    clock: string
    paid: string
    unknownPrice: string
    selectLot: string
    walkToDest: string
    backToList: string
  }
  badge: {
    free: string
    paid: string
    min: string
    unknown: string
  }
  zones: {
    vanalinn: string
    vanalinnGloss: string
    sydalinn: string
    sydalinnGloss: string
    kesklinn: string
    kesklinnGloss: string
    pirita: string
    piritaGloss: string
  }
  map: {
    markerFree: string
    markerClock: string
    markerPaid: string
    markerUnknown: string
    markerFull: string
    markerAlert: string
  }
  a11y: {
    focusHint: string
    addressLoading: string
    deleteAll: string
    openAppleMaps: string
    clearSearch: string
    largerRadius: string
    reportOther: string
  }
  notify: {
    unsupported: string
    missingKey: string
    denied: string
  }
  api: {
    INVALID_ZONE: string
    TOO_LONG: string
    END_BEFORE_START: string
    RATE_LIMITED: string
    UNAUTHORIZED: string
    NOT_FOUND: string
    SERVER_ERROR: string
    NETWORK_ERROR: string
    VALIDATION_ERROR: string
    UNKNOWN: string
    TSOON_PUUDUB: string
    VIGANE_PARING: string
  }
}
