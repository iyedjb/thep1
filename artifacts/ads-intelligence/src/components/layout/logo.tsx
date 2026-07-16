import React from "react";

type LogoProps = {
  className?: string;
  showText?: boolean;
  iconSize?: number | string;
  textClass?: string;
  textSizeClass?: string;
  forceTheme?: "light" | "dark";
};

export function Logo({
  className = "",
  showText = true,
  iconSize,
  textClass = "text-foreground dark:text-white",
  textSizeClass = "text-xl",
  forceTheme
}: LogoProps) {
  // Set default icon size depending on whether text is shown
  const finalIconSize = iconSize !== undefined ? iconSize : (showText ? 26 : 36);

  // Dynamic cursor color class depending on forced theme or auto dark mode
  const cursorFillClass = forceTheme === "light"
    ? "fill-[#08214D]"
    : forceTheme === "dark"
      ? "fill-white"
      : "fill-[#08214D] dark:fill-white";

  return (
    <div className={`flex items-center select-none ${className}`}>
      {showText ? (
        <div className={`flex items-center ${textSizeClass} font-extrabold tracking-tight ${textClass}`}>
          <span className="transition-colors duration-200">Clic</span>
          
          {/* Logo Target/Click Icon in the middle */}
          <svg
            width={finalIconSize}
            height={finalIconSize}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0 -ml-[0.14em] -mr-[0.12em]"
          >
            <defs>
              <linearGradient id="logoGradientText" x1="15" y1="15" x2="85" y2="85" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00D2FF" />
                <stop offset="100%" stopColor="#0066FF" />
              </linearGradient>
            </defs>
            
            {/* Outer Ring / Target */}
            <circle
              cx="46"
              cy="46"
              r="30"
              stroke="url(#logoGradientText)"
              strokeWidth="8"
            />

            {/* Magnifying Glass Handle (Q-tail) */}
            <line
              x1="66"
              y1="66"
              x2="80"
              y2="80"
              stroke="url(#logoGradientText)"
              strokeWidth="8"
              strokeLinecap="round"
            />

            {/* Concentric Thin Inner Circle */}
            <circle
              cx="46"
              cy="46"
              r="15"
              stroke="url(#logoGradientText)"
              strokeWidth="2.5"
              strokeOpacity="0.8"
            />

            {/* Center Target Dot */}
            <circle
              cx="46"
              cy="46"
              r="5"
              fill="url(#logoGradientText)"
            />

            {/* Cursor Pointer - pointing directly to the center dot from the bottom right */}
            {/* Tilting symmetric to the diagonal y = x axis */}
            <path
              d="M 47 47 L 47 58 L 51 54 L 58 61 L 61 58 L 54 51 L 58 47 Z"
              className={`${cursorFillClass} transition-colors duration-200`}
            />
          </svg>

          <span className="transition-colors duration-200">Lab</span>
        </div>
      ) : (
        /* Render only the icon if showText is false */
        <svg
          width={finalIconSize}
          height={finalIconSize}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0"
        >
          <defs>
            <linearGradient id="logoGradientOnly" x1="15" y1="15" x2="85" y2="85" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#00D2FF" />
              <stop offset="100%" stopColor="#0066FF" />
            </linearGradient>
          </defs>
          <circle
            cx="46"
            cy="46"
            r="30"
            stroke="url(#logoGradientOnly)"
            strokeWidth="8"
          />
          <line
            x1="66"
            y1="66"
            x2="80"
            y2="80"
            stroke="url(#logoGradientOnly)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <circle
            cx="46"
            cy="46"
            r="15"
            stroke="url(#logoGradientOnly)"
            strokeWidth="2.5"
            strokeOpacity="0.8"
          />
          <circle
            cx="46"
            cy="46"
            r="5"
            fill="url(#logoGradientOnly)"
          />
          <path
            d="M 47 47 L 47 58 L 51 54 L 58 61 L 61 58 L 54 51 L 58 47 Z"
            className={`${cursorFillClass} transition-colors duration-200`}
          />
        </svg>
      )}
    </div>
  );
}
