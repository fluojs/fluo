# konekti Brand Color Guide

## Primary Color: Orange

The signature color of the konekti framework is **orange**.

### Color Philosophy

- **Energy and Innovation**: Represents the vibrant development experience of the framework
- **High Visibility**: Establishes a distinctive identity in the technology ecosystem
- **Uncommon Choice**: Differentiated from Spring (green) and NestJS (red)

---

## Main Color Palette

| Name | HEX | RGB | Usage |
|------|-----|-----|-------|
| **Primary** | `#F97316` | `rgb(249, 115, 22)` | Main brand color, CTA buttons, logo |
| **Primary Dark** | `#EA580C` | `rgb(234, 88, 12)` | Hover states, dark backgrounds |
| **Primary Light** | `#FB923C` | `rgb(251, 146, 60)` | Emphasis, highlights |
| **Primary Lighter** | `#FDBA74` | `rgb(253, 186, 116)` | Background accents, light theme |
| **Primary Lightest** | `#FFEDD5` | `rgb(255, 237, 213)` | Light backgrounds, tag backgrounds |

---

## Gradients

### Main Gradient
```css
background: linear-gradient(135deg, #F97316 0%, #FB923C 50%, #FBBF24 100%);
```

### Dark Gradient
```css
background: linear-gradient(135deg, #EA580C 0%, #F97316 100%);
```

---

## Status Colors

| Status | HEX | Usage |
|--------|-----|-------|
| **Success** | `#10B981` | Success messages, completion states |
| **Warning** | `#F59E0B` | Warning messages |
| **Error** | `#EF4444` | Error messages, delete buttons |
| **Info** | `#3B82F6` | Information messages, help tooltips |

---

## Neutral Colors

| Name | HEX | Usage |
|------|-----|-------|
| **Gray 900** | `#111827` | Dark backgrounds, main text |
| **Gray 800** | `#1F2937` | Card backgrounds |
| **Gray 700** | `#374151` | Secondary text |
| **Gray 600** | `#4B5563` | Disabled text |
| **Gray 400** | `#9CA3AF` | Placeholders |
| **Gray 200** | `#E5E7EB` | Borders |
| **Gray 100** | `#F3F4F6` | Light backgrounds |

---

## Usage Examples

### Buttons
```css
/* Primary Button */
.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover {
  background: #EA580C;
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  border: 2px solid #F97316;
  color: #F97316;
}

.btn-secondary:hover {
  background: #FFEDD5;
}
```

### Logo Background
```css
.logo {
  background: linear-gradient(135deg, #F97316, #FB923C);
  color: white;
}
```

### Links
```css
a {
  color: #F97316;
}

a:hover {
  color: #EA580C;
}
```

---

## Accessibility

- **Primary (#F97316)** on white background: Contrast ratio 3.04:1 (AA Large)
- **Primary Dark (#EA580C)** on white background: Contrast ratio 3.87:1 (AA Large)
- When used as text color, must be paired with large text (18px+ or 14px bold)

---

## Competitive Framework Color Comparison

| Framework | Color | HEX |
|-----------|-------|-----|
| Spring Boot | Green | `#6DB33F` |
| NestJS | Red | `#E0234E` |
| Django | Green | `#092E20` |
| Express | Black | `#000000` |
| Fastify | Black | `#000000` |
| **konekti** | **Orange** | **`#F97316`** |

---

## File Location

This color guide is stored at:
- `docs/branding/color-palette.md` (English)
- `docs/branding/color-palette.ko.md` (Korean)

When a design system or component library is established, this guide will serve as the foundation for CSS variables or theme tokens.