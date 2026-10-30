import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Header from '../components/Header'
import SearchBar from '../components/SearchBar'
import { loadMetadata, assessPackage, removalCountsCombined, isRemovalBlocked } from '../lib/metadata'
import AppList, { type AppListHandle } from '../components/AppList'
import { type AppInfo } from '../lib/AppList'
import { useAppList } from '../lib/AppListContext'
import { whiteoutManager } from '../lib/Whiteout'
import { Cli } from '../lib/Cli'
import SnackBar, { useSnackBar } from '../components/SnackBar'
import Fab from '../components/Fab'
import { runMutation } from '../lib/mutationLock'
import LoadError from '../components/LoadError'
import { saveIcons } from '../lib/iconCache'

export default function Home() {
  const { t } = useTranslation()
  const { state: snackBarState, show: showSnackBar, hide: hideSnackBar } = useSnackBar()
  const appListManager = useAppList()
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [fabVisible, setFabVisible] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const appListRef = useRef<AppListHandle>(null)
  const [risky, setRisky] = useState<AppInfo[]>([])
  const [, setMetadataLoaded] = useState(false)

  useEffect(() => { void loadMetadata().then(() => setMetadataLoaded(true)) }, [])

  useEffect(() => {
    appListManager.waitForReady().then(() => {
      setApps(appListManager.systemAppList)
      setLoading(false)
    }).catch(() => {
      setLoadFailed(true)
      setLoading(false)
    })
  }, [appListManager])

  const handleFabVisibilityChange = useCallback((visible: boolean) => {
    setFabVisible(visible)
  }, [])

  const applyNuke = useCallback(async () => {
    const started = await runMutation(async () => {
      const selected = appListRef.current?.getSelectedPackages() ?? []
      const currentApps = appListManager.systemAppList
      let count = 0

      for (const app of currentApps) {
        const isSelected = selected.includes(app.packageName)

        if (isSelected) {
          appListManager.setNuke(app.packageName, true)
          count++
        }
      }

      if (count === 0) return
      showSnackBar(t('global.processing'), true, 60000)

      const ok = await appListManager.write()
      if (!ok) {
        showSnackBar(t('global.write_error'), false)
        setApps(appListManager.systemAppList)
      } else {
        await saveIcons(selected)
        // A failed nuke rolls the lists back on disk, so reload either way.
        await Cli.nuke(showSnackBar)
        await Promise.all([appListManager.refresh(), whiteoutManager.refresh()])
          .then(() => setApps(appListManager.systemAppList))
          .catch(() => {
            setLoadFailed(true)
            showSnackBar(t('global.read_error'), false)
          })
      }
    })
    if (!started) showSnackBar(t('global.processing'), true, 3000)
  }, [appListManager, showSnackBar, t])

  const handleFabClick = useCallback(async () => {
    await loadMetadata()
    const selected = appListRef.current?.getSelectedPackages() ?? []
    const blocked = selected.filter(isRemovalBlocked)
    if (blocked.length) {
      showSnackBar(`Protected Android components cannot be removed: ${blocked.join(', ')}`, false)
      return
    }
    const flagged = appListManager.systemAppList.filter(app =>
      selected.includes(app.packageName) && ['expert', 'unsafe', 'unknown'].includes(assessPackage(app.packageName).effective))
    if (flagged.length > 0) setRisky(flagged)
    else applyNuke()
  }, [appListManager, applyNuke, showSnackBar])

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <md-circular-progress indeterminate />
      </div>
    )
  }

  if (loadFailed) {
    return <LoadError />
  }

  return (
    <>
      <Header
        title={t('home.title')}
        bottomContent={
          <>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              filter={{ selected: selectedCategories, onToggle: toggleCategory, counts: removalCountsCombined(apps) }}
            />
          </>
        }
      />
      <AppList
        ref={appListRef}
        apps={apps}
        searchQuery={searchQuery}
        selectedCategories={selectedCategories}
        emptyMessage={apps.length === 0 ? t('home.empty') : t('global.no_results')}
      />
      <Fab
        onClick={handleFabClick}
        icon="remove_selection"
        label={t('home.apply')}
        variant="primary"
        onVisibilityChange={handleFabVisibilityChange}
      />
      <md-dialog open={risky.length > 0} onClosed={() => setRisky([])}>
        <div slot="headline">{t('home.risky_title')}</div>
        <div slot="content">
          {t('home.risky_message', { count: risky.length })}
          <p className="mt-2 text-sm">Unknown packages also require review. ADL and UAD-NG recommendations may differ; an explicit warning does not guarantee safety.</p>
          <ul className="mt-2 list-disc pl-5">
            {risky.map(app => <li key={app.packageName}>{app.appLabel} ({t(`removal.${assessPackage(app.packageName).effective}`)})</li>)}
          </ul>
        </div>
        <div slot="actions">
          <md-text-button onClick={() => setRisky([])}>{t('whiteout.cancel')}</md-text-button>
          <md-filled-button onClick={() => { setRisky([]); applyNuke() }}>{t('home.risky_confirm')}</md-filled-button>
        </div>
      </md-dialog>
      <SnackBar state={snackBarState} onHide={hideSnackBar} fabVisible={fabVisible} />
    </>
  )
}
