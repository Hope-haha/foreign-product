"""Create a transparent cutout and a platform-sized white-background image with BEN2."""
import argparse
from pathlib import Path


def make_white_canvas(foreground, destination, size):
    from PIL import Image

    # BEN2 may leave a faint alpha halo across the original frame. Ignore it
    # when determining the product bounds, otherwise the product becomes tiny.
    alpha = foreground.getchannel('A')
    box = alpha.point(lambda value: 255 if value >= 50 else 0).getbbox()
    if not box:
        raise ValueError('The product could not be located in the source image.')
    product = foreground.crop(box)
    width, height = size
    limit = int(min(width, height) * 0.84)
    scale = min(limit / product.width, limit / product.height)
    resized = product.resize((max(1, round(product.width * scale)), max(1, round(product.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', size, '#FFFFFF')
    left = (width - resized.width) // 2
    top = (height - resized.height) // 2
    canvas.paste(resized, (left, top), resized)
    canvas.save(destination, quality=95, subsampling=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True, help='Transparent PNG output')
    parser.add_argument('--white-output', required=True, help='White-background JPG output')
    parser.add_argument('--size', required=True, help='Widthxheight, e.g. 2000x2000')
    args = parser.parse_args()
    try:
        import torch
        from PIL import Image
        from ben2 import AutoModel
    except Exception as exc:
        raise SystemExit(f'BEN2 is not ready: {exc}')

    try:
        width, height = (int(value) for value in args.size.lower().split('x', 1))
    except ValueError as exc:
        raise SystemExit('--size must use the format WidthxHeight') from exc

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = AutoModel.from_pretrained('PramaLLC/BEN2').to(device).eval()
    foreground = model.inference(Image.open(args.input).convert('RGBA'))
    foreground.save(args.output)
    make_white_canvas(foreground, args.white_output, (width, height))
    print(Path(args.white_output))


if __name__ == '__main__':
    main()
