import type { Nav, NavColumn } from '@/lib/nav'
import NavItem from './NavItem'

/**
 * Band C — the category bar.
 *
 * A server component: every link and every count below is in the HTML the first response
 * carries. `NavItem` is the only client code in the header, and all it owns is a boolean.
 */
function Columns({ columns }: { columns: NavColumn[] }) {
  return (
    <>
      {columns.map((c, i) => (
        <div className="megacol" key={c.title || i}>
          {c.title && (
            <h3 className="megahead">
              {c.href ? <a href={c.href}>{c.title}</a> : c.title}
            </h3>
          )}
          <ul>
            {c.links.map((l) => (
              <li key={l.href}>
                <a href={l.href}>
                  <span>{l.label}</span>
                  {l.count !== undefined && (
                    <span className="n">{l.count.toLocaleString()}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export default function SiteNav({ nav }: { nav: Nav }) {
  return (
    <nav className="catnav" aria-label="Main">
      <div className="wrap">
        <ul className="catlist">
          {nav.bar.map((slot) => (
            <NavItem key={slot.key} label={slot.label} href={slot.href} flag={slot.flag}>
              {slot.panel && (
                <>
                  <Columns columns={slot.panel.columns} />
                  {slot.panel.footer && (
                    <p className="megafoot">
                      <a href={slot.panel.footer.href}>
                        {slot.panel.footer.label}
                        {slot.panel.footer.count !== undefined && (
                          <> &mdash; {slot.panel.footer.count.toLocaleString()}</>
                        )}{' '}
                        &rarr;
                      </a>
                    </p>
                  )}
                </>
              )}
            </NavItem>
          ))}
        </ul>
      </div>
    </nav>
  )
}

/**
 * The same model as a set of native disclosures, for the phone drawer.
 *
 * `<details>` rather than a React accordion: it is server-rendered, it opens with no
 * JavaScript at all, and the keyboard and screen-reader behaviour is the browser's rather
 * than something this file has to get right. The drawer around it is the only client part.
 */
export function NavAccordion({ nav }: { nav: Nav }) {
  return (
    <ul className="drawernav">
      {nav.bar.map((slot) =>
        slot.panel ? (
          <li key={slot.key}>
            <details>
              <summary>
                {slot.label}
                <svg width="11" height="7" viewBox="0 0 9 6" aria-hidden="true">
                  <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor"
                        strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </summary>
              <div className="drawersub">
                {slot.panel.columns.map((c, i) => (
                  <div key={c.title || i}>
                    {c.title && <h3>{c.href ? <a href={c.href}>{c.title}</a> : c.title}</h3>}
                    <ul>
                      {c.links.map((l) => (
                        <li key={l.href}>
                          <a href={l.href}>
                            <span>{l.label}</span>
                            {l.count !== undefined && <span className="n">{l.count}</span>}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {slot.panel.footer && (
                  <p className="drawerall">
                    <a href={slot.panel.footer.href}>{slot.panel.footer.label} &rarr;</a>
                  </p>
                )}
              </div>
            </details>
          </li>
        ) : (
          <li key={slot.key}>
            <a className="drawertop" href={slot.href}>
              {slot.label}
              {slot.flag && <span className="navflag">{slot.flag}</span>}
            </a>
          </li>
        )
      )}
    </ul>
  )
}
