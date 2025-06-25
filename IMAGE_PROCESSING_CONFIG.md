# Image Processing Configuration Guide

The Ethereum Time Capsule now supports configurable image processing parameters through the `public_config.json` file. This allows you to control the dithering and pixelation effects applied to capsule preview images.

## Configuration Location

The image processing parameters are stored in `frontend/public_config.json` under the `image_processing` section:

```json
{
  "image_processing": {
    "pixelation_factor": 14,
    "smoothing_factor": 12,
    "enable_floyd_steinberg_dithering": true,
    "enable_advanced_dithering": true
  }
}
```

## Parameters

### `pixelation_factor` (number, default: 14)
Controls the intensity of the pixelation effect. Lower values create smaller pixels (higher resolution), higher values create larger pixels (more pixelated).

- **Range**: 1-50
- **Low values (1-8)**: High detail, subtle pixelation
- **Medium values (10-16)**: Moderate pixelation (recommended)
- **High values (20+)**: Heavy pixelation, blocky appearance

### `smoothing_factor` (number, default: 12)  
Controls the intensity of the smoothing pass applied after pixelation. Lower values create more smoothing, higher values preserve more pixelated edges.

- **Range**: 1-30
- **Low values (1-8)**: Heavy smoothing, blurred appearance
- **Medium values (10-16)**: Moderate smoothing (recommended)
- **High values (20+)**: Minimal smoothing, preserves pixelated edges

### `enable_floyd_steinberg_dithering` (boolean, default: true)
Enables or disables the Floyd-Steinberg dithering algorithm, which distributes quantization errors to create a more visually appealing result.

- **true**: Apply Floyd-Steinberg dithering (recommended for artistic effect)
- **false**: Skip dithering step, preserves smooth gradients

### `enable_advanced_dithering` (boolean, default: true)
Master switch for the entire advanced dithering pipeline.

- **true**: Apply full 3-step process (pixelate → smoothen → dither)
- **false**: Use simple pixelation only (legacy mode)

## Processing Pipeline

When `enable_advanced_dithering` is true, images go through this 3-step process:

1. **Pixelation**: Reduce resolution by `pixelation_factor`, then upscale with nearest-neighbor
2. **Smoothing**: Apply smoothing filter based on `smoothing_factor`  
3. **Dithering**: Apply Floyd-Steinberg error diffusion (if enabled)

When `enable_advanced_dithering` is false, only step 1 (pixelation) is applied.

## Example Configurations

### High Quality (Subtle Effect)
```json
{
  "pixelation_factor": 8,
  "smoothing_factor": 6,
  "enable_floyd_steinberg_dithering": true,
  "enable_advanced_dithering": true
}
```

### Strong Artistic Effect (Default)
```json
{
  "pixelation_factor": 14,
  "smoothing_factor": 12,
  "enable_floyd_steinberg_dithering": true,
  "enable_advanced_dithering": true
}
```

### Heavy Pixelation
```json
{
  "pixelation_factor": 20,
  "smoothing_factor": 18,
  "enable_floyd_steinberg_dithering": true,
  "enable_advanced_dithering": true
}
```

### Legacy Mode (Simple Pixelation)
```json
{
  "pixelation_factor": 14,
  "smoothing_factor": 12,
  "enable_floyd_steinberg_dithering": false,
  "enable_advanced_dithering": false
}
```

## Testing Your Configuration

1. **Test Configuration Validity**: Run `python test_dithering_config.py` to verify your config file is properly formatted.

2. **Check Backend Configuration**: Visit `/api/image-processing-config` endpoint to see what parameters the backend is using.

3. **Visual Testing**: Create a test capsule and observe the preview image to see the effects of your parameters.

## Implementation Details

- **Frontend**: JavaScript canvas-based processing in `app.js`
- **Backend**: Python PIL-based processing in `app.py`
- **Synchronization**: Both frontend and backend read from the same config file to ensure consistent results

## Troubleshooting

- **Config not loading**: Check JSON syntax with a validator
- **Parameters ignored**: Restart both frontend and backend after config changes
- **Default values used**: Verify the `image_processing` section exists in your config file

The system includes fallback values, so if the config file is missing or malformed, it will use the default parameters (14, 12, true, true).
