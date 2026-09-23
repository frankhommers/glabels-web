import type { DocumentObject } from '../api/types'
import { LabelCanvas } from '../editor/LabelCanvas'
import { ObjectEditor } from '../components/ObjectEditor'
import { createObject } from '../editor/objects'
import { toPt } from '../editor/units'
import { Icon } from '../ui/Icon'
import type { Actions } from '../app/actions'
import { fitZoom, type Session } from '../app/session'
import { useLooseT, type LooseTranslate } from '../i18n'
import { labelSize } from '../editor/label'
import type { Limitation } from '../api/types'

export const CREATE_TOOLS = [
  { type: 'text', icon: 'glabels-text' },
  { type: 'box', icon: 'glabels-box' },
  { type: 'line', icon: 'glabels-line' },
  { type: 'ellipse', icon: 'glabels-ellipse' },
  { type: 'barcode', icon: 'glabels-barcode' },
] as const

export type CreatableType = (typeof CREATE_TOOLS)[number]['type']

export function addObject(session: Session, type: CreatableType) {
  const created = createObject(type, toPt(5, 'mm'), toPt(5, 'mm'), session.t('object.newText'))
  const id = `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  session.commit([...session.objects, { ...created, id }])
  session.setSelection([id])
}

export function EditorPage({
  session,
  actions,
  fontFamilies,
}: {
  session: Session
  actions: Actions
  fontFamilies: string[]
}) {
  const t = session.t
  const loose = useLooseT()
  const { detail, objects, selection, zoom, unit } = session
  if (!detail) return null

  const readOnly = detail.limitations.some(
    (limitation) => limitation.blocks_editing && limitation.code === 'document-version',
  )

  const patchObject = (id: string, patch: Partial<DocumentObject>) => {
    session.commit(
      objects.map((object) => (object.id === id ? ({ ...object, ...patch } as DocumentObject) : object)),
    )
  }

  const zoomToFit = () => {
    const { w, h } = labelSize(detail)
    session.setZoom(fitZoom(w, h))
  }

  return (
    <div className="editor-page">
      <div className="toolbar editor-toolbar">
        <button type="button" className="tool active" title={t('editor.select')}>
          <Icon name="glabels-arrow" size={16} />
        </button>
        <span className="toolbar-separator" />
        {CREATE_TOOLS.map((tool) => (
          <button
            key={tool.type}
            type="button"
            className="tool"
            title={t('editor.create', { object: t(`object.${tool.type}`) })}
            disabled={readOnly}
            onClick={() => addObject(session, tool.type)}
          >
            <Icon name={tool.icon} size={16} />
          </button>
        ))}
        <button
          type="button"
          className="tool"
          title={t('editor.imageNotYet')}
          disabled
        >
          <Icon name="glabels-image" size={16} />
        </button>
        <span className="toolbar-separator" />
        <button type="button" className="tool" title={t('editor.cut')} disabled={!actions.hasSelection} onClick={actions.cut}>
          <Icon name="glabels-edit-cut" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.copy')} disabled={!actions.hasSelection} onClick={actions.copy}>
          <Icon name="glabels-edit-copy" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.paste')} disabled={!actions.hasClipboard} onClick={actions.paste}>
          <Icon name="glabels-edit-paste" size={16} />
        </button>
        <span className="toolbar-separator" />
        <button type="button" className="tool" title={t('editor.raise')} disabled={!actions.hasSelection} onClick={actions.raise}>
          <Icon name="glabels-order-top" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.lower')} disabled={!actions.hasSelection} onClick={actions.lower}>
          <Icon name="glabels-order-bottom" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.rotateLeft')} disabled={!actions.hasSelection} onClick={() => actions.rotate(-90)}>
          <Icon name="glabels-rotate-left" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.rotateRight')} disabled={!actions.hasSelection} onClick={() => actions.rotate(90)}>
          <Icon name="glabels-rotate-right" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.flipHorizontal')} disabled={!actions.hasSelection} onClick={() => actions.flip('horizontal')}>
          <Icon name="glabels-flip-horiz" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.flipVertical')} disabled={!actions.hasSelection} onClick={() => actions.flip('vertical')}>
          <Icon name="glabels-flip-vert" size={16} />
        </button>
        <span className="toolbar-separator" />
        <button type="button" className="tool" title={t('editor.alignLeft')} disabled={selection.length < 2} onClick={() => actions.align('left')}>
          <Icon name="glabels-align-left" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.alignHCenter')} disabled={selection.length < 2} onClick={() => actions.align('hcenter')}>
          <Icon name="glabels-align-hcenter" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.alignRight')} disabled={selection.length < 2} onClick={() => actions.align('right')}>
          <Icon name="glabels-align-right" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.alignTop')} disabled={selection.length < 2} onClick={() => actions.align('top')}>
          <Icon name="glabels-align-top" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.alignVCenter')} disabled={selection.length < 2} onClick={() => actions.align('vcenter')}>
          <Icon name="glabels-align-vcenter" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.alignBottom')} disabled={selection.length < 2} onClick={() => actions.align('bottom')}>
          <Icon name="glabels-align-bottom" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.centerOnLabel')} disabled={!actions.hasSelection} onClick={() => actions.centerOnLabel('both')}>
          <Icon name="glabels-center" size={16} />
        </button>
        <span className="toolbar-separator" />
        <button type="button" className="tool" title={t('editor.zoomOut')} onClick={() => session.setZoom(Math.max(0.25, zoom / 1.25))}>
          <Icon name="glabels-zoom-out" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.zoomIn')} onClick={() => session.setZoom(Math.min(12, zoom * 1.25))}>
          <Icon name="glabels-zoom-in" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.actualSize')} onClick={() => session.setZoom(1)}>
          <Icon name="glabels-zoom-one-to-one" size={16} />
        </button>
        <button type="button" className="tool" title={t('editor.zoomToFit')} onClick={zoomToFit}>
          <Icon name="glabels-zoom-to-fit" size={16} />
        </button>
        <span className="zoom-info">{Math.round(zoom * 100)}%</span>
      </div>

      {detail.limitations.length > 0 ? (
        <ul className="limitation-bar">
          {detail.limitations.map((limitation) => (
            <li
              key={limitation.code + limitation.message}
              className={limitation.blocks_editing ? 'warning' : 'notice'}
            >
              {/* The server also sends the message as text; we use it when this
                  version does not know the code yet. */}
              {translateLimitation(loose, limitation)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="editor-split">
        <div className="canvas-scroll">
          <LabelCanvas
            document={detail}
            objects={objects}
            selection={selection}
            zoom={zoom}
            showGrid={session.showGrid}
            showMarkup={session.showMarkup}
            snap={session.snap}
            gridPt={toPt(1, 'mm')}
            onSelectionChange={session.setSelection}
            onObjectsPreview={session.history.replace}
            onObjectsCommit={session.commit}
          />
        </div>
        <ObjectEditor
          objects={objects}
          selection={selection}
          unit={unit}
          fontFamilies={fontFamilies}
          onChange={patchObject}
        />
      </div>
    </div>
  )
}

/** Show messages from the server in the user's language. */
function translateLimitation(loose: LooseTranslate, limitation: Limitation): string {
  return loose(`limitation.${limitation.code}`, limitation.params) ?? limitation.message
}
