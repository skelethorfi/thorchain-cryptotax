// Calendar days in an IANA timezone, as Summ dates tax years in the account's timezone.

function offsetMs(time: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(new Date(time))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(time / 1000) * 1000
}

/** The instant (ms) of midnight at the start of `date` (YYYY-MM-DD) in timeZone. */
export function startOfDay(date: string, timeZone: string): number {
    const [y, m, d] = date.split('-').map(Number)
    const guess = Date.UTC(y, m - 1, d)
    const first = guess - offsetMs(guess, timeZone)
    return guess - offsetMs(first, timeZone)
}

/** The day after `date` (YYYY-MM-DD). */
export function nextDay(date: string): string {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** Whether `time` is in the period: from midnight starting `from` to midnight ending `to`, in timeZone. */
export function inPeriod(time: string, period: { from: string; to: string }, timeZone: string): boolean {
    const t = Date.parse(time)
    return t >= startOfDay(period.from, timeZone) && t < startOfDay(nextDay(period.to), timeZone)
}

/** Whether `time` is before midnight starting `date` in timeZone. */
export function before(time: string, date: string, timeZone: string): boolean {
    return Date.parse(time) < startOfDay(date, timeZone)
}
