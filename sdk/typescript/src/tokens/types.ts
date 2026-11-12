export interface SpringToken {
  response: number;
  dampingRatio: number;
}

export interface MotionProfileData {
  label: string;
  description: string;
  duration: { instant: number; fast: number; normal: number; slow: number; page: number };
  spring: { snappy: SpringToken; standard: SpringToken; gentle: SpringToken; bouncy: SpringToken };
  easing: {
    standard: [number, number, number, number];
    enter: [number, number, number, number];
    exit: [number, number, number, number];
  };
  pressScale: number;
  hoverLift: number;
  depth: number;
  stagger: number;
  parallax: number;
  intensity: number;
  elasticity: number;
  flingTimeConstant: number;
  distanceScale: number;
}

export interface ProfilesData {
  schemaVersion: number;
  default: string;
  profiles: Record<string, MotionProfileData>;
  reducedMotion: {
    strategy: string;
    maxDuration: number;
    allowSpatial: boolean;
    allowParallax: boolean;
    allowParticles: boolean;
    allowScale: boolean;
  };
}
