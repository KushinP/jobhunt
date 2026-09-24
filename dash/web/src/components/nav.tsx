import { createContext, useContext } from 'react';

/** Opening a role or a company from anywhere (a board card, a table row, inside a panel)
 * without threading callbacks through every component. */
export const NavContext = createContext<{
  openJob: (id: string) => void;
  openCompany: (name: string) => void;
}>({ openJob: () => {}, openCompany: () => {} });

export function useNav() {
  return useContext(NavContext);
}

export function CompanyLink({ name, className = '' }: { name: string; className?: string }) {
  const nav = useNav();
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); nav.openCompany(name); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`max-w-full truncate text-left hover:text-accent hover:underline
                  underline-offset-2 ${className}`}
      title={`Every role at ${name}`}
    >
      {name}
    </button>
  );
}
