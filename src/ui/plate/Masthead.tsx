import { Seal } from "../brand/Seal";
import { Cartouche } from "./Cartouche";

export function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead__brand">
        <Seal size={48} title="Dynamique-Chimie" />
        <h1 className="masthead__name">
          Dynamique-Chimie
          <small className="masthead__motto">Nihil nisi vires — tout émerge des forces</small>
        </h1>
      </div>
      <Cartouche />
    </header>
  );
}
