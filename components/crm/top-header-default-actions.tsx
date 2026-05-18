/**
 * Default right slot for CRM TopHeader — "+ New client" + account menu.
 * Used on Analysis, CRM, Tasks, Reports, and any route that does not
 * override rightActions with section-specific CTAs.
 */

import { NewClientButton } from "./new-client-button";
import { UserMenu } from "./user-menu";

export function TopHeaderDefaultActions() {
  return (
    <>
      <NewClientButton />
      <UserMenu />
    </>
  );
}
