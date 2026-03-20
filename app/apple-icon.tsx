import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        borderRadius: 40,
        background: 'linear-gradient(145deg, #12122a 0%, #0a0a16 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="110" height="110" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 1L10.3 7.2L16.5 9L10.3 10.8L9 17L7.7 10.8L1.5 9L7.7 7.2L9 1Z"
          fill="#78b4ff"
          stroke="#a8d0ff"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    { ...size },
  );
}
