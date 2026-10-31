# User product definitions

The bundled database holds 1481 products from 32 brands. If your label sheet
is not among them, or differs slightly, you can make a definition of your own.

## Through the interface

1. Choose **New label** and search for the product that comes closest.
2. Click **New based on this…**. Without a selection you start from an empty
   A4 sheet.
3. Fill in brand, part number and sizes. On the right the sheet changes along
   right away, with warnings when labels overlap or fall outside the sheet.
4. **Save**. The definition then appears in the product list and can be used
   right away.

A user definition can be changed later (**Edit…**) or deleted. Bundled
definitions are left alone: they belong to the upstream database, and
overwriting them is refused.

## How it is stored

Every definition is one XML file in the `templates` folder of the shared
folder:

```
data/shared/templates/Custombrand-LAB-70x37.xml
```

The content has the same shape as the bundled database:

```xml
<?xml version="1.0"?>
<Glabels-templates>
  <Template brand="Custombrand" part="LAB-70x37" size="A4" description="Custom label 70 × 37 mm">
    <Label-rectangle id="0" width="198.425pt" height="104.882pt" round="5.66929pt">
      <Markup-margin size="5.66929pt"/>
      <Layout nx="3" ny="8" x0="0pt" y0="0pt" dx="198.425pt" dy="104.882pt"/>
    </Label-rectangle>
  </Template>
</Glabels-templates>
```

That means you can:

- **download** a definition and put it in `~/.glabels` on a desktop machine;
  gLabels Qt reads it there;
- **put** definitions from a colleague or from the internet **straight in**,
  through the Files page or the volume. They are picked up by themselves;
- include them in a backup or in version control.

## What is checked

Saving refuses what would make an unusable sheet:

- an empty brand or part number;
- a label without width or height;
- a paper size without dimensions;
- a sheet layout with fewer than one row or column;
- labels that fall outside the sheet (with half a millimetre of slack for
  rounding).

Overlapping labels give a warning in the preview, but do not block saving:
sometimes that is exactly the point, for example on a continuous roll.

## What is not possible yet

- Several label shapes in one definition (the DTD allows it; the interface
  edits only the first).
- Markup other than the margin (`Markup-line`, `-circle`, `-rect`,
  `-ellipse`). It is kept in definitions you import, but cannot be edited
  here.
- `Label-path`, the shape with a free path. One product in the bundled
  database uses it (Dymo 30915) and is therefore missing from the list.
- Assigning categories. A derived definition takes them over from its
  starting point.

## Products glabels-web adds

Next to upstream's database, glabels-web ships product definitions of its own
in `backend/glabels_web/templates/extra/`, one file per source. They behave as
bundled definitions; removing a file removes its products.

### NIIMBOT label rolls

`niimbot-templates.xml` holds one product per NIIMBOT label size, for all
NIIMBOT printers. It is generated from the online label catalogue NIIMBOT's
own app uses:

```sh
python3 scripts/update-niimbot-templates.py
```

The file is committed; the build does not go online. The catalogue is not a
documented service, so the script may need adjusting when it changes.

Each size becomes a roll product: the width runs across the roll, the height
along it, in the direction the label leaves the printer. A cable label is
longer by its tail, which follows the printable part. The guides show the
areas meant for text (the two faces of a cable flag) and where the tail
starts. Search by printer model (`D110`) or by the name on the box
(`T12.5*74+35`).

## Favourites and recently used

In the product list, the star marks a favourite. Favourites and the products
chosen most recently are listed above all products, as long as no search or
filter is active. They are kept on the server, so every device shows the same
list.
