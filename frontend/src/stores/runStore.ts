import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import { RunStockShortError, type DevRun } from '../types/dev-run'

type NewRun = Omit<DevRun, 'id' | 'schemaRev' | 'filmId' | 'emulsionNo' | 'consumed'>

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: [] as DevRun[],
    loading: false
  }),
  getters: {
    recentRuns: (state) => [...state.runs]
      .sort((a, b) => b.runDate.localeCompare(a.runDate))
      .slice(0, 6)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.runs = await db.runs.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    /**
     * 保存冲洗记录：按所选配方扣掉对应胶片一卷，并快照当时乳剂批号，
     * 同时累加一卷显影液用量。胶片余量不足时整笔事务中止，
     * 记录与显影液用量都不写入。
     */
    async addRun(payload: NewRun): Promise<number> {
      const id = await db.transaction('rw', db.runs, db.recipes, db.films, db.developers, async () => {
        const recipe = await db.recipes.get(payload.recipeId)
        if (!recipe || recipe.filmId === undefined) {
          throw new RunStockShortError('所选配方未关联胶片批次，无法扣减胶片余量')
        }
        const film = await db.films.get(recipe.filmId)
        if (!film) {
          throw new RunStockShortError('配方对应的胶片批次已不在台账中，无法扣减胶片余量')
        }
        if (film.rollsLeft <= 0) {
          throw new RunStockShortError(
            `${film.model} · ${film.format}（${film.emulsionNo}）余量不足，已缺货，请补货或改选其他配方`,
            film
          )
        }
        const runId = await db.runs.add(plain({
          ...payload,
          filmId: film.id,
          emulsionNo: film.emulsionNo,
          consumed: true,
          schemaRev: 3
        }))
        await db.films.update(film.id!, plain({ rollsLeft: film.rollsLeft - 1 }))
        const developer = await db.developers.get(recipe.developerId)
        if (developer && developer.id !== undefined && developer.state !== '报废') {
          await db.developers.update(developer.id, plain({ usedRolls: developer.usedRolls + 1 }))
        }
        return runId
      })
      await this.load()
      return id
    },
    /**
     * 撤销一次消耗：记录保留，胶片余量退回一卷、显影液用量退回一卷，
     * 撤销后该记录不再计入消耗且不可重复撤销。
     */
    async undoConsumption(runId: number): Promise<void> {
      await db.transaction('rw', db.runs, db.recipes, db.films, db.developers, async () => {
        const run = await db.runs.get(runId)
        if (!run || run.consumed === false) return
        const recipe = await db.recipes.get(run.recipeId)
        const filmId = run.filmId ?? recipe?.filmId
        if (filmId !== undefined) {
          const film = await db.films.get(filmId)
          if (film && film.id !== undefined) {
            await db.films.update(film.id, plain({ rollsLeft: film.rollsLeft + 1 }))
          }
        }
        if (recipe) {
          const developer = await db.developers.get(recipe.developerId)
          // 与保存时的计入条件保持一致：报废药液当初未加用量，撤销时也不退回
          if (developer && developer.id !== undefined && developer.state !== '报废' && developer.usedRolls > 0) {
            await db.developers.update(developer.id, plain({ usedRolls: developer.usedRolls - 1 }))
          }
        }
        await db.runs.update(runId, plain({ consumed: false }))
      })
      await this.load()
    },
    async writeBackNote(runId: number, recipeId: number): Promise<void> {
      const run = await db.runs.get(runId)
      if (!run) return
      const note = `${run.runDate} 实冲 ${run.actualTempC}°C / ${run.actualMinutes} 分钟：${run.result}`
      await db.recipes.update(recipeId, plain({ note }))
    }
  }
})
