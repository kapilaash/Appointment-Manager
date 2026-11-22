import { getCountryCode, getTimeZones } from '@vvo/tzdb';

const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
const timeZones = getTimeZones({ locale }).filter((zone) => /^[A-Z]{2}$/.test(zone.countryCode));
const countries = Array.from(new Map(timeZones.map((zone) => [zone.countryCode, zone.countryName])).entries()).sort(
  (left, right) => left[1].localeCompare(right[1], locale),
);

type Props = {
  countryCode: string;
  timezone: string;
  onCountryCodeChange: (countryCode: string) => void;
  onTimezoneChange: (timezone: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  countryLabel?: string;
  timezoneLabel?: string;
};

function offsetLabel(timezone: string): string {
  return (
    new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

export function TimeZoneSelect({
  countryCode,
  timezone,
  onCountryCodeChange,
  onTimezoneChange,
  className = '',
  disabled = false,
  required = false,
  countryLabel = 'Country',
  timezoneLabel = 'Time zone',
}: Props) {
  const selectedCountry = countryCode || getCountryCode(timezone) || '';
  const countryZones = timeZones.filter((zone) => zone.countryCode === selectedCountry);
  const matchingZone = countryZones.find((zone) => zone.group.includes(timezone));
  const selectedZone = matchingZone?.name ?? (countryZones.some((zone) => zone.name === timezone) ? timezone : '');

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium text-neutral-700">
        {countryLabel}
        <select
          required={required}
          disabled={disabled}
          value={selectedCountry}
          onChange={(event) => {
            onCountryCodeChange(event.target.value);
            onTimezoneChange('');
          }}
          className={`mt-1.5 w-full rounded-lg border border-neutral-300 bg-surface px-3 py-2.5 text-sm ${className}`}
        >
          <option value="">Choose a country</option>
          {countries.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-neutral-700">
        {timezoneLabel}
        <select
          required={required}
          disabled={disabled || !selectedCountry}
          value={selectedZone}
          onChange={(event) => onTimezoneChange(event.target.value)}
          className={`mt-1.5 w-full rounded-lg border border-neutral-300 bg-surface px-3 py-2.5 text-sm ${className}`}
        >
          <option value="">{selectedCountry ? 'Choose a region or city' : 'Choose a country first'}</option>
          {countryZones.map((zone) => (
            <option key={zone.name} value={zone.name}>
              {zone.alternativeName} · {zone.mainCities.join(', ')} · {zone.name} (current offset{' '}
              {offsetLabel(zone.name)})
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs font-normal text-neutral-500 sm:col-span-2">
        Times use the selected IANA region and follow its daylight saving time rules automatically.
      </p>
    </div>
  );
}
